import { Button, Card, Checkbox, InlineAlert, Input, Modal, Select, StatusBadge, Textarea } from "@isker/design-system";
import { useMemo, useState } from "react";
import { adminApi, useAdminAssessments, useAdminCompetencies, useAdminMutation, useAdminQuestions, type AdminQuestion, type QuestionInput } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import type { QuestionType } from "../../types/api";

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

function parse(f: FormState, assessmentId: number, idByCode: Map<string, number>): QuestionInput {
  const options = f.options.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const [label, score] = l.split("|").map((s) => s.trim());
    if (!label || score === undefined || Number.isNaN(Number(score))) throw new Error(`Option line ${i + 1} must look like "Label | 75".`);
    return { label, score: Number(score), value: f.type === "likert" ? i + 1 : null };
  });
  const competencies = f.links.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [code, w] = l.split("|").map((s) => s.trim());
    const id = idByCode.get(code);
    if (!id) throw new Error(`Unknown competency code "${code}".`);
    return { competency_id: id, weight: Number(w ?? 1) };
  });
  let rubric;
  try { rubric = JSON.parse(f.rubric || "[]"); } catch { throw new Error("Rubric must be valid JSON."); }
  return { assessment_id: assessmentId, type: f.type, section: f.section, text: f.text, help_text: f.help_text || null, min_length: Number(f.min_length) || 0,
    reverse_scored: f.reverse_scored, is_active: f.is_active, options, competencies, rubric };
}

export function AdminQuestions() {
  const qs = useAdminQuestions();
  const comps = useAdminCompetencies();
  const assessments = useAdminAssessments();
  const [form, setForm] = useState<FormState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const toast = useToast();
  const save = useAdminMutation((v: { id?: number; body: QuestionInput }) => (v.id ? adminApi.updateQuestion(v.id, v.body) : adminApi.createQuestion(v.body)));
  const deactivate = useAdminMutation(adminApi.deactivateQuestion);
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
      save.mutate({ id: form.id, body: parse(form, assessmentId, idByCode) }, { onSuccess: () => { setForm(null); toast({ title: "Question saved" }); } });
    } catch (e) { setLocalError((e as Error).message); }
  };
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => form && setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 220 }}><Select aria-label="Filter by type" placeholder="All types" value={filter} onChange={(e) => setFilter(e.target.value)} options={["likert", "situational", "open", "practical"]} /></div>
        <Button iconLeft="plus" onClick={() => { setLocalError(null); setForm(BLANK); }}>New question</Button>
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Competencies</th><th className="num">Answers</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((q) => (
              <tr key={q.id}>
                <td className="num">{q.sort_order}</td>
                <td style={{ maxWidth: 420 }}>{q.text}<div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{q.section}</div></td>
                <td>{q.type}</td>
                <td style={{ fontSize: 12 }}>{q.competencies.map((l) => `${codeById.get(l.competency_id)} (${l.weight})`).join(", ")}</td>
                <td className="num">{q.answer_count}</td>
                <td>{q.is_active ? <StatusBadge status="done">Active</StatusBadge> : <StatusBadge status="todo">Inactive</StatusBadge>}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="ghost" onClick={() => { setLocalError(null); setForm(toForm(q, codeById)); }}>Edit</Button>
                  {q.is_active && <Button size="sm" variant="ghost" onClick={() => deactivate.mutate(q.id, { onSuccess: () => toast({ title: "Question deactivated" }) })}>Deactivate</Button>}
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit question" : "New question"}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}>
        {form && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            {(localError || save.error) && <InlineAlert>{localError ?? errorMessage(save.error)}</InlineAlert>}
            <div className="ik-form2">
              <Select label="Type" value={form.type} onChange={set("type")} options={["likert", "situational", "open", "practical"]} />
              <Input label="Section" value={form.section} onChange={set("section")} />
            </div>
            <Textarea label="Question text" rows={3} value={form.text} onChange={set("text")} />
            <Input label="Help text" value={form.help_text} onChange={set("help_text")} />
            {form.type === "likert" || form.type === "situational"
              ? <Textarea label="Options" rows={5} hint='One per line: "Label | score 0–100"' value={form.options} onChange={set("options")} />
              : <><Input label="Minimum answer length" type="number" min="0" value={form.min_length} onChange={set("min_length")} />
                  <Textarea label="Rubric (JSON)" rows={6} hint='[{"criterion": "...", "description": "...", "competency": "code", "keywords": ["..."]}]' value={form.rubric} onChange={set("rubric")} /></>}
            <Textarea label="Measured competencies" rows={3} hint='One per line: "competency-code | weight (0–1)"' value={form.links} onChange={set("links")} />
            <Checkbox label="Reverse scored" checked={form.reverse_scored} onChange={(e) => setForm({ ...form, reverse_scored: e.target.checked })} />
            <Checkbox label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          </div>
        )}
      </Modal>
    </>
  );
}
