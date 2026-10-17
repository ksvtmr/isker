import { Badge, Button, Card, Checkbox, EmptyState, Input, Select, Textarea } from "@isker/design-system";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminAssessments, useAdminCompetencies, useAdminMutation, useAdminQuestions, type AdminQuestion, type ContentStatus, type QuestionInput, type TranslationLang } from "../../api/admin";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import type { QuestionType } from "../../types/api";
import { formatNumber } from "../../utils/format";
import { ContentStatusBadge, EditorFooter, EditorModal, LANGS, TranslationStatusBadge, SaveError, TranslationFields, fromTranslationForm, toTranslationForm, useStatusActions, useStatusOptions, type TranslationField, type TranslationForm } from "./contentSync";

/** JSON shape of a rubric (keys are API field names and are not translated). */
export const RUBRIC_EXAMPLE = '[{"criterion": "...", "description": "...", "competency": "code", "keywords": ["..."]}]';

const QUESTION_TYPES: QuestionType[] = ["likert", "situational", "open", "practical"];

interface FormState {
  assessment_id?: number; id?: number; lock_version?: number; status: ContentStatus; answered: number; type: QuestionType; section: string; text: string; help_text: string; min_length: string; reverse_scored: boolean;
  options: string; links: string; rubric: string; tr: TranslationForm; optionTr: Record<TranslationLang, string>;
}

const BLANK_TR = { ru: {}, kk: {} } as TranslationForm;
/**
 * Base (English) section names stored with each question; the backend seed uses exactly these values
 * (backend/app/seed/questions.py S_*), so they are kept as-is and only their labels are translated.
 */
export const QUESTION_SECTIONS: [string, string][] = [
  ["Self-assessment", "questions.sections.self"],
  ["Situational judgement", "questions.sections.situational"],
  ["Open answers", "questions.sections.open"],
  ["Practical task", "questions.sections.practical"],
];
const DEFAULT_SECTION: Record<QuestionType, string> = { likert: "Self-assessment", situational: "Situational judgement", open: "Open answers", practical: "Practical task" };

const BLANK: FormState = { status: "draft", answered: 0, type: "situational", section: DEFAULT_SECTION.situational, text: "", help_text: "", min_length: "0", reverse_scored: false, options: "", links: "", rubric: "[]", tr: BLANK_TR, optionTr: { ru: "", kk: "" } };

/** Text formats keep the editor small: one option per line "Label | score", one link per line "competency-code | weight". */
function toForm(q: AdminQuestion, codeById: Map<number, string>, fields: TranslationField[]): FormState {
  const optionLabels = (lang: TranslationLang) => q.options.map((o) => String(o.translations?.[lang]?.label ?? "")).join("\n").replace(/\n+$/, "");
  return {
    assessment_id: q.assessment_id, id: q.id, lock_version: q.lock_version, status: q.status, answered: q.answer_count, type: q.type, section: q.section, text: q.text, help_text: q.help_text ?? "", min_length: String(q.min_length),
    reverse_scored: q.reverse_scored, tr: toTranslationForm(q.translations, fields), optionTr: { ru: optionLabels("ru"), kk: optionLabels("kk") },
    options: q.options.map((o) => `${o.label} | ${o.score}`).join("\n"),
    links: q.competencies.map((l) => `${codeById.get(l.competency_id)} | ${l.weight}`).join("\n"),
    rubric: JSON.stringify(q.rubric, null, 2),
  };
}

function parse(f: FormState, assessmentId: number, idByCode: Map<string, number>, t: TFunction<"adminContent">, fields: TranslationField[]): QuestionInput {
  const optionTr = (lang: TranslationLang) => f.optionTr[lang].split("\n").map((l) => l.trim());
  const options = f.options.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const [label, score] = l.split("|").map((s) => s.trim());
    if (!label || score === undefined || Number.isNaN(Number(score))) throw new Error(t("questions.errors.optionLine", { line: i + 1 }));
    const translations = Object.fromEntries(LANGS.filter((lang) => optionTr(lang)[i]).map((lang) => [lang, { label: optionTr(lang)[i] }]));
    return { label, score: Number(score), value: f.type === "likert" ? i + 1 : null, translations };
  });
  const competencies = f.links.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const [code, w] = l.split("|").map((s) => s.trim());
    const id = idByCode.get(code);
    if (!id) throw new Error(t("questions.errors.unknownCompetency", { code }));
    // The API accepts weights in (0, 1]; an empty weight means 1. Never send NaN.
    const weight = w === undefined || w === "" ? 1 : Number(w.replace(",", "."));
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1) throw new Error(t("questions.errors.weight", { line: i + 1 }));
    return { competency_id: id, weight };
  });
  if (!competencies.length) throw new Error(t("questions.errors.noCompetency"));
  const minLength = Number(f.min_length || 0);
  if (!Number.isInteger(minLength) || minLength < 0 || minLength > 2000) throw new Error(t("questions.errors.minLength"));
  if (f.text.trim().length < 10) throw new Error(t("questions.errors.textShort"));
  let rubric;
  try { rubric = JSON.parse(f.rubric || "[]"); } catch { throw new Error(t("content.rubricInvalid")); }
  const translations = fromTranslationForm(f.tr, fields, (lang, field) => t("sync.translations.invalidJson", { lang, field }));
  return { assessment_id: f.assessment_id ?? assessmentId, type: f.type, section: f.section, text: f.text, help_text: f.help_text || null, min_length: minLength,
    reverse_scored: f.reverse_scored, options, competencies, rubric, translations, ...(f.id ? { expected_version: f.lock_version } : { status: f.status }) };
}

export function AdminQuestions() {
  const { t } = useTranslation("adminContent");
  const qs = useAdminQuestions();
  const comps = useAdminCompetencies();
  const assessments = useAdminAssessments();
  const [form, setForm] = useState<FormState | null>(null);
  const [initial, setInitial] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [picked, setPicked] = useState<number | null>(null);
  const toast = useToast();
  const save = useAdminMutation((v: { id?: number; body: QuestionInput }) => (v.id ? adminApi.updateQuestion(v.id, v.body) : adminApi.createQuestion(v.body)));
  const status = useStatusActions();
  const statusOpts = useStatusOptions();
  const codeById = useMemo(() => new Map((comps.data ?? []).map((c) => [c.id, c.code])), [comps.data]);
  const idByCode = useMemo(() => new Map((comps.data ?? []).map((c) => [c.code, c.id])), [comps.data]);
  const trFields: TranslationField[] = useMemo(() => [
    { key: "section", label: t("questions.form.section") }, { key: "text", label: t("questions.form.text"), multiline: true },
    { key: "help_text", label: t("questions.form.helpText") },
    { key: "rubric", label: t("sync.translations.rubric"), json: true, hint: t("sync.translations.rubricHint") },
  ], [t]);

  if (qs.isLoading || comps.isLoading || assessments.isLoading) return <PageSkeleton chart={false} />;
  if (qs.error || !qs.data) return <ErrorState error={qs.error} onRetry={() => qs.refetch()} />;
  if (assessments.error || !assessments.data) return <ErrorState error={assessments.error} onRetry={() => assessments.refetch()} />;
  if (!assessments.data.length) {
    // Questions always belong to an assessment: there is nothing to attach them to yet (never guess an id).
    return <EmptyState icon="clipboard-list" title={t("questions.noAssessmentsTitle")} description={t("questions.noAssessmentsText")} />;
  }
  const assessmentId = assessments.data.some((a) => a.id === picked) ? (picked as number) : assessments.data[0].id;
  const inAssessment = qs.data.filter((q) => q.assessment_id === assessmentId);
  const rows = inAssessment.filter((q) => (!filter || q.type === filter) && (!statusFilter || q.status === statusFilter));
  const open = (f: FormState) => { setLocalError(null); save.reset(); setForm(f); setInitial(JSON.stringify(f)); };
  const reload = async () => {
    const fresh = await qs.refetch();
    const row = fresh.data?.find((q) => q.id === form?.id);
    if (row) { open(toForm(row, codeById, trFields)); toast({ title: t("sync.conflict.reloaded") }); }
  };
  const submit = () => {
    if (!form) return;
    let body: QuestionInput;
    try { setLocalError(null); body = parse(form, assessmentId, idByCode, t, trFields); } catch (e) { setLocalError((e as Error).message); return; }
    save.mutate({ id: form.id, body }, {
      onSuccess: (saved) => {
        setForm(null);
        toast({ title: saved.replaced_id ? t("sync.newVersion", { n: saved.version }) : t("questions.saved") });
      },
    });
  };
  const typeLabel = (type: QuestionType) => t(`questions.types.${type}`);
  const typeOpts = QUESTION_TYPES.map((v) => ({ value: v, label: typeLabel(v) }));
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => form && setForm({ ...form, [k]: e.target.value });
  const sectionLabel = (value: string) => {
    const key = QUESTION_SECTIONS.find(([v]) => v === value)?.[1];
    return key ? t(key) : value;
  };
  const sectionOpts = [
    ...QUESTION_SECTIONS.map(([value]) => ({ value, label: sectionLabel(value) })),
    // A section created outside this editor stays selectable as it is.
    ...(form && !QUESTION_SECTIONS.some(([v]) => v === form.section) && form.section ? [{ value: form.section, label: form.section }] : []),
  ];
  const assessmentOpts = assessments.data.map((a) => ({ value: String(a.id), label: a.title }));
  const dirty = !!form && JSON.stringify(form) !== initial;

  return (
    <>
      {status.dialog}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ width: 260 }}><Select label={t("questions.assessment")} value={String(assessmentId)} onChange={(e) => setPicked(Number(e.target.value))} options={assessmentOpts} /></div>
          <div style={{ width: 220, alignSelf: "end" }}><Select aria-label={t("questions.filterByType")} placeholder={t("questions.allTypes")} value={filter} onChange={(e) => setFilter(e.target.value)} options={typeOpts} /></div>
          <div style={{ width: 200, alignSelf: "end" }}><Select aria-label={t("sync.filterStatus")} placeholder={t("sync.allStatuses")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={statusOpts} /></div>
        </div>
        <Button iconLeft="plus" style={{ alignSelf: "end" }} onClick={() => open({ ...BLANK, assessment_id: assessmentId, tr: toTranslationForm(null, trFields) })}>{t("questions.new")}</Button>
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>{t("common:format.numberHeader")}</th><th>{t("questions.columns.question")}</th><th>{t("questions.columns.type")}</th><th>{t("questions.columns.competencies")}</th><th className="num">{t("questions.columns.answers")}</th><th>{t("content.status")}</th><th><span className="isk-sr-only">{t("content.actions")}</span></th></tr></thead>
            <tbody>{rows.length === 0 && (
              <tr><td colSpan={7}><EmptyState icon="clipboard-list" title={inAssessment.length ? t("content.noMatchesTitle") : t("questions.emptyTitle")}
                description={inAssessment.length ? t("content.noMatchesText") : t("questions.emptyText")} /></td></tr>
            )}{rows.map((q) => (
              <tr key={q.id}>
                <td className="num">{q.sort_order}</td>
                <td style={{ maxWidth: 420 }}>{q.text}<div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{sectionLabel(q.section)}{q.version > 1 && <> · <Badge tone="info">{t("sync.version", { n: q.version })}</Badge></>}</div></td>
                <td>{typeLabel(q.type)}</td>
                <td style={{ fontSize: 12 }}>{q.competencies.map((l) => `${codeById.get(l.competency_id)} (${l.weight})`).join(", ")}</td>
                <td className="num">{formatNumber(q.answer_count)}</td>
                <td><ContentStatusBadge status={q.status} /> <TranslationStatusBadge status={q.translation_status} /></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {q.status !== "archived" && <Button size="sm" variant="ghost" onClick={() => open(toForm(q, codeById, trFields))}>{t("common:actions.edit")}</Button>}
                  {status.buttons({ entity: "questions", id: q.id, status: q.status, lock_version: q.lock_version, title: q.text.slice(0, 60) })}
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
      <EditorModal open={!!form} dirty={dirty} onDiscard={() => setForm(null)} title={form?.id ? t("questions.edit") : t("questions.new")}
        footer={(requestClose) => <EditorFooter dirty={dirty} saving={save.isPending} onCancel={requestClose} onReset={() => setForm(JSON.parse(initial))} onSave={submit} />}>
        {form && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            <SaveError error={save.error} local={localError} onReload={reload} />
            {form.answered > 0 && <p className="isk-hint">{t("sync.versionHint", { count: form.answered })}</p>}
            <Select label={t("questions.assessment")} value={String(form.assessment_id ?? assessmentId)} disabled={!!form.id}
              onChange={(e) => setForm({ ...form, assessment_id: Number(e.target.value) })} options={assessmentOpts} />
            <div className="ik-form2">
              <Select label={t("questions.columns.type")} value={form.type}
                onChange={(e) => { const type = e.target.value as QuestionType; setForm({ ...form, type, section: form.id ? form.section : DEFAULT_SECTION[type] }); }} options={typeOpts} />
              <Select label={t("questions.form.section")} value={form.section} onChange={set("section")} options={sectionOpts} />
            </div>
            <Textarea label={t("questions.form.text")} rows={3} value={form.text} onChange={set("text")} />
            <Input label={t("questions.form.helpText")} value={form.help_text} onChange={set("help_text")} />
            {form.type === "likert" || form.type === "situational"
              ? <Textarea label={t("questions.form.options")} rows={5} hint={t("questions.form.optionsHint")} value={form.options} onChange={set("options")} />
              : <><Input label={t("questions.form.minLength")} type="number" min="0" value={form.min_length} onChange={set("min_length")} />
                  <Textarea label={t("content.form.rubric")} rows={6} hint={<>{t("content.form.rubricHint")} <code>{RUBRIC_EXAMPLE}</code></>} value={form.rubric} onChange={set("rubric")} /></>}
            <Textarea label={t("questions.form.competencies")} rows={3} hint={t("questions.form.competenciesHint")} value={form.links} onChange={set("links")} />
            <Checkbox label={t("questions.form.reverseScored")} checked={form.reverse_scored} onChange={(e) => setForm({ ...form, reverse_scored: e.target.checked })} />
            <TranslationFields fields={trFields} value={form.tr} onChange={(tr) => setForm({ ...form, tr })} />
            {(form.type === "likert" || form.type === "situational") && LANGS.map((lang) => (
              <Textarea key={lang} label={t("sync.translations.options", { lang: lang.toUpperCase() })} hint={t("sync.translations.optionsHint")} rows={4}
                value={form.optionTr[lang]} onChange={(e) => setForm({ ...form, optionTr: { ...form.optionTr, [lang]: e.target.value } })} />
            ))}
            {!form.id && <p className="isk-hint">{t("sync.draftHint")}</p>}
          </div>
        )}
      </EditorModal>
    </>
  );
}
