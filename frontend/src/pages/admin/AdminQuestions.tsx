import { Button, Card, Checkbox, InlineAlert, Input, Modal, Select, StatusBadge, Textarea } from "@isker/design-system";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminAssessments, useAdminCompetencies, useAdminMutation, useAdminQuestions, type AdminQuestion, type QuestionInput } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useConfirmAction } from "./common";
import { useToast } from "../../components/Toaster";
import type { QuestionType } from "../../types/api";
import { formatNumber } from "../../utils/format";

const QUESTION_TYPES: QuestionType[] = ["likert", "situational", "open", "practical"];

interface FormState { id?: number; type: QuestionType; section: string; text: string; help_text: string; min_length: string; reverse_scored: boolean; is_active: boolean; options: string; links: string; rubric: string }

const BLANK: FormState = { type: "situational", section: "Situational judgement", text: "", help_text: "", min_length: "0", reverse_scored: false, is_active: true, options: "", links: "", rubric: "[]" };

/** Text formats keep the editor small: one option per line "Label | score", one link per line "competency-code | weight". */
function toForm(q: AdminQuestion, codeById: Map<number, string>): FormState {
  return {
    id: q.id, type: q.type, section: q.section, text: q.text, help_text: q.help_text ?? "", min_length: String(q.min_length), reverse_scored: q.reverse_scored, is_active: q.is_active,
    options: q.options.map((o) => `${o.label} | ${o.score}`).join("\n"),
    links: q.competencies.map((l) => `${codeById.get(l.competency_id)} | ${l.weight}`).join("\n"),
    rubric: JSON.stringify(q.rubric, null, 2),
  };
}

function parse(f: FormState, assessmentId: number, idByCode: Map<string, number>, t: TFunction<"adminContent">): QuestionInput {
  const options = f.options.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const [label, score] = l.split("|").map((s) => s.trim());
    if (!label || score === undefined || Number.isNaN(Number(score))) throw new Error(t("questions.errors.optionLine", { line: i + 1 }));
    return { label, score: Number(score), value: f.type === "likert" ? i + 1 : null };
  });
  const competencies = f.links.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [code, w] = l.split("|").map((s) => s.trim());
    const id = idByCode.get(code);
    if (!id) throw new Error(t("questions.errors.unknownCompetency", { code }));
    return { competency_id: id, weight: Number(w ?? 1) };
  });
  let rubric;
  try { rubric = JSON.parse(f.rubric || "[]"); } catch { throw new Error(t("content.rubricInvalid")); }
  return { assessment_id: assessmentId, type: f.type, section: f.section, text: f.text, help_text: f.help_text || null, min_length: Number(f.min_length) || 0,
    reverse_scored: f.reverse_scored, is_active: f.is_active, options, competencies, rubric };
}

export function AdminQuestions() {
  const { t } = useTranslation("adminContent");
  const qs = useAdminQuestions();
  const comps = useAdminCompetencies();
  const assessments = useAdminAssessments();
  const [form, setForm] = useState<FormState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const toast = useToast();
  const save = useAdminMutation((v: { id?: number; body: QuestionInput }) => (v.id ? adminApi.updateQuestion(v.id, v.body) : adminApi.createQuestion(v.body)));
  const deactivate = useAdminMutation(adminApi.deactivateQuestion);
  const confirm = useConfirmAction();
  const codeById = useMemo(() => new Map((comps.data ?? []).map((c) => [c.id, c.code])), [comps.data]);
  const idByCode = useMemo(() => new Map((comps.data ?? []).map((c) => [c.code, c.id])), [comps.data]);

  if (qs.isLoading || comps.isLoading || assessments.isLoading) return <PageSkeleton chart={false} />;
  if (qs.error || !qs.data) return <ErrorState error={qs.error} onRetry={() => qs.refetch()} />;
  const assessmentId = assessments.data?.[0]?.id ?? 1;
  const rows = qs.data.filter((q) => !filter || q.type === filter);
  const submit = () => {
    if (!form) return;
    try {
      setLocalError(null);
      save.mutate({ id: form.id, body: parse(form, assessmentId, idByCode, t) }, { onSuccess: () => { setForm(null); toast({ title: t("questions.saved") }); } });
    } catch (e) { setLocalError((e as Error).message); }
  };
  const typeLabel = (type: QuestionType) => t(`questions.types.${type}`);
  const typeOpts = QUESTION_TYPES.map((v) => ({ value: v, label: typeLabel(v) }));
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => form && setForm({ ...form, [k]: e.target.value });

  return (
    <>
      {confirm.dialog}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 220 }}><Select aria-label={t("questions.filterByType")} placeholder={t("questions.allTypes")} value={filter} onChange={(e) => setFilter(e.target.value)} options={typeOpts} /></div>
        <Button iconLeft="plus" onClick={() => { setLocalError(null); setForm(BLANK); }}>{t("questions.new")}</Button>
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>#</th><th>{t("questions.columns.question")}</th><th>{t("questions.columns.type")}</th><th>{t("questions.columns.competencies")}</th><th className="num">{t("questions.columns.answers")}</th><th>{t("content.status")}</th><th><span className="isk-sr-only">{t("content.actions")}</span></th></tr></thead>
            <tbody>{rows.map((q) => (
              <tr key={q.id}>
                <td className="num">{q.sort_order}</td>
                <td style={{ maxWidth: 420 }}>{q.text}<div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{q.section}</div></td>
                <td>{typeLabel(q.type)}</td>
                <td style={{ fontSize: 12 }}>{q.competencies.map((l) => `${codeById.get(l.competency_id)} (${l.weight})`).join(", ")}</td>
                <td className="num">{formatNumber(q.answer_count)}</td>
                <td>{q.is_active ? <StatusBadge status="done">{t("content.active")}</StatusBadge> : <StatusBadge status="todo">{t("content.inactive")}</StatusBadge>}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="ghost" onClick={() => { setLocalError(null); setForm(toForm(q, codeById)); }}>{t("common:actions.edit")}</Button>
                  {q.is_active && <Button size="sm" variant="ghost" onClick={() => confirm.ask({ title: t("questions.deactivateTitle"), description: t("questions.deactivateText"), confirmLabel: t("content.deactivate"), success: t("questions.deactivated"), run: () => deactivate.mutateAsync(q.id) })}>{t("content.deactivate")}</Button>}
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t("questions.edit") : t("questions.new")}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>{t("common:actions.cancel")}</Button><Button loading={save.isPending} onClick={submit}>{t("common:actions.save")}</Button></>}>
        {form && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            {(localError || save.error) && <InlineAlert>{localError ?? errorMessage(save.error)}</InlineAlert>}
            <div className="ik-form2">
              <Select label={t("questions.columns.type")} value={form.type} onChange={set("type")} options={typeOpts} />
              <Input label={t("questions.form.section")} value={form.section} onChange={set("section")} />
            </div>
            <Textarea label={t("questions.form.text")} rows={3} value={form.text} onChange={set("text")} />
            <Input label={t("questions.form.helpText")} value={form.help_text} onChange={set("help_text")} />
            {form.type === "likert" || form.type === "situational"
              ? <Textarea label={t("questions.form.options")} rows={5} hint={t("questions.form.optionsHint")} value={form.options} onChange={set("options")} />
              : <><Input label={t("questions.form.minLength")} type="number" min="0" value={form.min_length} onChange={set("min_length")} />
                  <Textarea label={t("content.form.rubric")} rows={6} hint='[{"criterion": "...", "description": "...", "competency": "code", "keywords": ["..."]}]' value={form.rubric} onChange={set("rubric")} /></>}
            <Textarea label={t("questions.form.competencies")} rows={3} hint={t("questions.form.competenciesHint")} value={form.links} onChange={set("links")} />
            <Checkbox label={t("questions.form.reverseScored")} checked={form.reverse_scored} onChange={(e) => setForm({ ...form, reverse_scored: e.target.checked })} />
            <Checkbox label={t("content.active")} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          </div>
        )}
      </Modal>
    </>
  );
}
