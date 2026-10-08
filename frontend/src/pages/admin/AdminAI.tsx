import { Button, Card, Checkbox, InlineAlert, Modal, Select, StatusBadge, Tabs, Textarea } from "@isker/design-system";
import { useState } from "react";
import { adminApi, useAdminEvaluations, useAdminMutation, useAdminPrompts, type AIEvaluationRow, type PromptVersion } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { formatDate } from "../../utils/format";

function Evaluations() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AIEvaluationRow | null>(null);
  const { data, isLoading, error, refetch } = useAdminEvaluations(status, page);
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const badge = (s: AIEvaluationRow["status"]) => s === "success" ? <StatusBadge status="done">Success</StatusBadge> : s === "retried" ? <StatusBadge status="progress">Retried</StatusBadge> : <StatusBadge status="locked">Fallback</StatusBadge>;
  return (
    <>
      <div style={{ width: 220, marginBottom: 16 }}>
        <Select aria-label="Filter by status" placeholder="All statuses" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "success", label: "Success" }, { value: "retried", label: "Retried" }, { value: "fallback", label: "Fallback" }]} />
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>#</th><th>Input</th><th>Provider · model</th><th>Status</th><th className="num">Score</th><th className="num">Confidence</th><th className="num">Latency</th><th>Date</th><th /></tr></thead>
            <tbody>{data.items.map((e) => (
              <tr key={e.id}>
                <td className="num">{e.id}</td><td>{e.input_type.replace(/_/g, " ")}</td><td>{e.provider} · {e.model}</td><td>{badge(e.status)}</td>
                <td className="num">{e.score ?? "—"}</td><td className="num">{e.confidence?.toFixed(2) ?? "—"}</td><td className="num">{e.latency_ms ?? "—"} ms</td>
                <td>{formatDate(e.created_at)}</td><td><Button size="sm" variant="ghost" iconLeft="eye" onClick={() => setOpen(e)}>Inspect</Button></td>
              </tr>))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--color-neutral-100)", fontSize: 13, color: "var(--color-neutral-500)" }}>
          <span>{data.total} evaluations</span>
          <span style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
          </span>
        </div>
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Evaluation #${open?.id ?? ""}`}>
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <dl className="ik-kv"><dt>Prompt version id</dt><dd>{open.prompt_version_id ?? "built-in"}</dd><dt>Attempts</dt><dd>{open.attempts}</dd><dt>Level</dt><dd>{open.level ?? "—"}</dd></dl>
            {open.error && <InlineAlert tone="warning" title="Errors">{open.error}</InlineAlert>}
            <p className="isk-label">Input excerpt</p><pre className="ik-pre">{open.input_excerpt}</pre>
            <p className="isk-label">Validated output</p><pre className="ik-pre">{JSON.stringify(open.output, null, 2)}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}

function Prompts() {
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
              <div><b>{p.key}</b> · v{p.version} <span style={{ marginLeft: 8 }}>{p.is_active ? <StatusBadge status="done">Active</StatusBadge> : <StatusBadge status="todo">Inactive</StatusBadge>}</span>
                <div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{formatDate(p.created_at)}{p.notes ? ` · ${p.notes}` : ""}</div></div>
              <span style={{ display: "flex", gap: 8 }}>
                {!p.is_active && <Button size="sm" variant="secondary" loading={activate.isPending} onClick={() => activate.mutate(p.id, { onSuccess: () => toast({ title: `Prompt v${p.version} activated` }) })}>Activate</Button>}
                <Button size="sm" variant="ghost" iconLeft="plus" onClick={() => newVersion(p)}>New version from this</Button>
              </span>
            </div>
            <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", fontSize: 13 }}>Show template</summary><pre className="ik-pre" style={{ marginTop: 8 }}>{p.system_prompt}{"\n\n---\n\n"}{p.user_template}</pre></details>
          </Card>
        ))}
      </div>
      <Modal open={!!draft} onClose={() => setDraft(null)} title={`New ${draft?.key ?? ""} version`}
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button loading={create.isPending} onClick={() => draft && create.mutate(draft, { onSuccess: () => { setDraft(null); toast({ title: "Prompt version created" }); } })}>Create</Button></>}>
        {draft && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto" }}>
            {create.error && <InlineAlert>{errorMessage(create.error)}</InlineAlert>}
            <Textarea label="System prompt" rows={8} value={draft.system_prompt} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} />
            <Textarea label="User template" rows={5} hint={draft.key === "answer_evaluation" ? "Placeholders: {competency} {question} {rubric} {answer}" : "Placeholder: {facts}"} value={draft.user_template} onChange={(e) => setDraft({ ...draft, user_template: e.target.value })} />
            <Textarea label="Notes" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            <Checkbox label="Activate immediately" checked={draft.activate} onChange={(e) => setDraft({ ...draft, activate: e.target.checked })} />
          </div>
        )}
      </Modal>
    </>
  );
}

export function AdminAI() {
  const [tab, setTab] = useState("evaluations");
  return (
    <>
      <div style={{ marginBottom: 16 }}><Tabs ariaLabel="AI governance" value={tab} onChange={setTab} tabs={[{ value: "evaluations", label: "Evaluation log" }, { value: "prompts", label: "Prompt versions" }]} /></div>
      {tab === "evaluations" ? <Evaluations /> : <Prompts />}
    </>
  );
}
