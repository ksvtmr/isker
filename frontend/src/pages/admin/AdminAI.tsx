import { Button, Card, Checkbox, InlineAlert, Modal, Select, StatusBadge, Tabs, Textarea } from "@isker/design-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminEvaluations, useAdminMutation, useAdminPrompts, type AIEvaluationRow, type PromptVersion } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { formatDate, formatNumber } from "../../utils/format";

function Evaluations() {
  const { t } = useTranslation("adminContent");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AIEvaluationRow | null>(null);
  const { data, isLoading, error, refetch } = useAdminEvaluations(status, page);
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const statusLabel = (s: AIEvaluationRow["status"]) => t(`ai.statuses.${s}`);
  const badge = (s: AIEvaluationRow["status"]) => <StatusBadge status={s === "success" ? "done" : s === "retried" ? "progress" : "locked"}>{statusLabel(s)}</StatusBadge>;
  const inputLabel = (v: string) => t(`ai.inputTypes.${v}`, { defaultValue: v.replace(/_/g, " ") });
  return (
    <>
      <div style={{ width: 220, marginBottom: 16 }}>
        <Select aria-label={t("ai.filterByStatus")} placeholder={t("ai.allStatuses")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={(["success", "retried", "fallback"] as const).map((v) => ({ value: v, label: statusLabel(v) }))} />
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>#</th><th>{t("ai.columns.input")}</th><th>{t("ai.columns.provider")}</th><th>{t("content.status")}</th><th className="num">{t("ai.columns.score")}</th><th className="num">{t("ai.columns.confidence")}</th><th className="num">{t("ai.columns.latency")}</th><th>{t("ai.columns.date")}</th><th><span className="isk-sr-only">{t("content.actions")}</span></th></tr></thead>
            <tbody>{data.items.map((e) => (
              <tr key={e.id}>
                <td className="num">{e.id}</td><td>{inputLabel(e.input_type)}</td><td>{e.provider} · {e.model}</td><td>{badge(e.status)}</td>
                <td className="num">{e.score ?? "—"}</td><td className="num">{e.confidence != null ? formatNumber(e.confidence, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td><td className="num">{e.latency_ms != null ? t("ai.latencyMs", { n: formatNumber(e.latency_ms) }) : "—"}</td>
                <td>{formatDate(e.created_at)}</td><td><Button size="sm" variant="ghost" iconLeft="eye" onClick={() => setOpen(e)}>{t("ai.inspect")}</Button></td>
              </tr>))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--color-neutral-100)", fontSize: 13, color: "var(--color-neutral-500)" }}>
          <span>{t("ai.evaluationsCount", { count: data.total, n: formatNumber(data.total) })}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("ai.previous")}</Button>
            <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>{t("common:actions.next")}</Button>
          </span>
        </div>
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={t("ai.evaluationTitle", { id: open?.id ?? "" })}>
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <dl className="ik-kv"><dt>{t("ai.promptVersionId")}</dt><dd>{open.prompt_version_id ?? t("ai.builtIn")}</dd><dt>{t("ai.attempts")}</dt><dd>{open.attempts}</dd><dt>{t("ai.level")}</dt><dd>{open.level ? t(`common:levels.${open.level}`, { defaultValue: open.level }) : "—"}</dd></dl>
            {open.error && <InlineAlert tone="warning" title={t("ai.errors")}>{open.error}</InlineAlert>}
            <p className="isk-label">{t("ai.inputExcerpt")}</p><pre className="ik-pre">{open.input_excerpt}</pre>
            <p className="isk-label">{t("ai.validatedOutput")}</p><pre className="ik-pre">{JSON.stringify(open.output, null, 2)}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}

function Prompts() {
  const { t } = useTranslation("adminContent");
  const { data, isLoading, error, refetch } = useAdminPrompts();
  const toast = useToast();
  const activate = useAdminMutation(adminApi.activatePrompt);
  const create = useAdminMutation(adminApi.createPrompt);
  const [draft, setDraft] = useState<{ key: string; system_prompt: string; user_template: string; notes: string; activate: boolean } | null>(null);
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const newVersion = (p: PromptVersion) => setDraft({ key: p.key, system_prompt: p.system_prompt, user_template: p.user_template, notes: "", activate: false });
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {data.map((p) => (
          <Card key={p.id} padding={20}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div><b>{p.key}</b> · v{p.version} <span style={{ marginLeft: 8 }}>{p.is_active ? <StatusBadge status="done">{t("content.active")}</StatusBadge> : <StatusBadge status="todo">{t("content.inactive")}</StatusBadge>}</span>
                <div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{formatDate(p.created_at)}{p.notes ? ` · ${p.notes}` : ""}</div></div>
              <span style={{ display: "flex", gap: 8 }}>
                {!p.is_active && <Button size="sm" variant="secondary" loading={activate.isPending} onClick={() => activate.mutate(p.id, { onSuccess: () => toast({ title: t("ai.promptActivated", { version: p.version }) }) })}>{t("content.activate")}</Button>}
                <Button size="sm" variant="ghost" iconLeft="plus" onClick={() => newVersion(p)}>{t("ai.newVersionFrom")}</Button>
              </span>
            </div>
            <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", fontSize: 13 }}>{t("ai.showTemplate")}</summary><pre className="ik-pre" style={{ marginTop: 8 }}>{p.system_prompt}{"\n\n---\n\n"}{p.user_template}</pre></details>
          </Card>
        ))}
      </div>
      <Modal open={!!draft} onClose={() => setDraft(null)} title={t("ai.newVersionTitle", { key: draft?.key ?? "" })}
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>{t("common:actions.cancel")}</Button><Button loading={create.isPending} onClick={() => draft && create.mutate(draft, { onSuccess: () => { setDraft(null); toast({ title: t("ai.versionCreated") }); } })}>{t("common:actions.create")}</Button></>}>
        {draft && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto" }}>
            {create.error && <InlineAlert>{errorMessage(create.error)}</InlineAlert>}
            <Textarea label={t("ai.form.systemPrompt")} rows={8} value={draft.system_prompt} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} />
            <Textarea label={t("ai.form.userTemplate")} rows={5} hint={draft.key === "answer_evaluation" ? t("ai.form.placeholders", { list: "{competency} {question} {rubric} {answer}" }) : t("ai.form.placeholder", { list: "{facts}" })} value={draft.user_template} onChange={(e) => setDraft({ ...draft, user_template: e.target.value })} />
            <Textarea label={t("ai.form.notes")} rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            <Checkbox label={t("ai.form.activateNow")} checked={draft.activate} onChange={(e) => setDraft({ ...draft, activate: e.target.checked })} />
          </div>
        )}
      </Modal>
    </>
  );
}

export function AdminAI() {
  const { t } = useTranslation("adminContent");
  const [tab, setTab] = useState("evaluations");
  return (
    <>
      <div style={{ marginBottom: 16 }}><Tabs ariaLabel={t("content.aiPage.title")} value={tab} onChange={setTab} tabs={[{ value: "evaluations", label: t("ai.tabEvaluations") }, { value: "prompts", label: t("ai.tabPrompts") }]} /></div>
      {tab === "evaluations" ? <Evaluations /> : <Prompts />}
    </>
  );
}
