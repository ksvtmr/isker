import { AnswerOption, AssessmentProgress, Button, Card, EmptyState, Icon, InlineAlert, Modal, Skeleton, Textarea } from "@isker/design-system";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { assessmentsApi, useAttempt, useSubmitAttempt } from "../api/assessments";
import { ApiError, errorMessage } from "../api/client";
import { LinkButton } from "../components/RouterLink";
import { ErrorState } from "../components/States";
import type { Question } from "../types/api";

type Draft = { option_id?: number | null; text?: string };
type SaveState = "idle" | "saving" | "saved" | "error";

const TEXT_DEBOUNCE_MS = 800;

export function isAnswered(q: Question, d: Draft | undefined): boolean {
  if (!d) return false;
  if (q.options.length) return d.option_id !== undefined && d.option_id !== null;
  return (d.text ?? "").trim().length >= Math.max(1, q.min_length);
}

/** Radio group with roving focus: arrow keys move and select, as in a native radio group. */
function ChoiceGroup({ q, value, onChange }: { q: Question; value: number | null | undefined; onChange: (id: number) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = q.options.findIndex((o) => o.id === value);
  const onKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const n = (i + dir + q.options.length) % q.options.length;
    refs.current[n]?.focus();
    onChange(q.options[n].id);
  };
  return (
    <div role="radiogroup" aria-labelledby={`q-${q.id}`} style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
      {q.options.map((o, k) => (
        <AnswerOption
          key={o.id}
          ref={(el) => { refs.current[k] = el; }}
          index={k}
          label={o.label}
          checked={value === o.id}
          tabIndex={idx === -1 ? (k === 0 ? 0 : -1) : k === idx ? 0 : -1}
          onKeyDown={onKey(k)}
          onSelect={() => onChange(o.id)}
        />
      ))}
    </div>
  );
}

function Analyzing() {
  return (
    <div style={{ maxWidth: 560, margin: "12vh auto 0", padding: 16 }} role="status" aria-live="polite">
      <Card padding={32}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--color-brand-700)" }}>
          <Icon name="sparkles" size={18} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>Scoring your answers</span>
        </div>
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--color-neutral-500)" }}>
          Open answers are scored against EntreComp rubrics. Every score comes with evidence from your own words.
        </p>
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={10} width="80%" /><Skeleton height={10} width="65%" /><Skeleton height={10} width="72%" />
        </div>
      </Card>
    </div>
  );
}

export function AssessmentRunner() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useAttempt(id);
  const submit = useSubmitAttempt();

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<{ qid: number; body: Draft } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const initialised = useRef(false);

  // Initialise local state from the server once (resume where the user stopped).
  useEffect(() => {
    if (!data || initialised.current) return;
    initialised.current = true;
    const d: Record<number, Draft> = {};
    for (const a of data.answers) d[a.question_id] = { option_id: a.option_id, text: a.text_response ?? undefined };
    setDrafts(d);
    setIndex(Math.min(data.attempt.current_index, Math.max(0, data.questions.length - 1)));
  }, [data]);

  const persist = useCallback(async (qid: number, body: Draft, position: number) => {
    setSaveState("saving");
    try {
      await assessmentsApi.saveAnswer(id, qid, body.option_id != null ? { option_id: body.option_id, position } : { text_response: body.text ?? "", position });
      if (pending.current?.qid === qid) pending.current = null;
      setSaveState("saved");
      setSaveError(null);
    } catch (e) {
      setSaveState("error");
      setSaveError(errorMessage(e, "Your answer couldn't be saved."));
      throw e;
    }
  }, [id]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (p) await persist(p.qid, p.body, index);
  }, [persist, index]);

  // Warn before leaving with unsaved changes (closing the tab, reload).
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (pending.current || saveState === "saving" || saveState === "error") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [saveState]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!Number.isFinite(id)) return <Navigate to="/assessment" replace />;
  if (submit.isPending) return <Analyzing />;
  if (isLoading || (data && !initialised.current)) {
    return <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }} aria-busy="true"><Skeleton height={10} /><div style={{ height: 24 }} /><Skeleton height={220} radius={14} /></div>;
  }
  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div style={{ maxWidth: 560, margin: "12vh auto 0", padding: 16 }}>
        {notFound
          ? <EmptyState icon="search-x" title="Assessment not found" description="This assessment doesn't exist or belongs to another account." action={<LinkButton to="/assessment">Back to assessment</LinkButton>} />
          : <ErrorState error={error} onRetry={() => refetch()} />}
      </div>
    );
  }
  if (data.attempt.status === "completed") return <Navigate to={`/results?attempt=${id}`} replace />;
  if (data.attempt.status === "abandoned") {
    return <div style={{ maxWidth: 560, margin: "12vh auto 0", padding: 16 }}><EmptyState icon="clipboard-list" title="This attempt was closed" description="Start a new assessment to continue." action={<LinkButton to="/assessment">Go to assessment</LinkButton>} /></div>;
  }

  const questions = data.questions;
  const q = questions[index];
  const draft = drafts[q.id];
  const answered = isAnswered(q, draft);
  const unanswered = questions.filter((x) => !isAnswered(x, drafts[x.id])).length;
  const isLast = index === questions.length - 1;
  const title = data.attempt.scope === "competency" ? `Reassessment · ${data.attempt.competency?.name}` : "Assessment";

  const choose = (optionId: number) => {
    setDrafts((d) => ({ ...d, [q.id]: { option_id: optionId } }));
    pending.current = { qid: q.id, body: { option_id: optionId } };
    persist(q.id, { option_id: optionId }, index).catch(() => {});
  };
  const type = (text: string) => {
    setDrafts((d) => ({ ...d, [q.id]: { text } }));
    pending.current = { qid: q.id, body: { text } };
    setSaveState("idle");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(q.id, { text }, index).catch(() => {}), TEXT_DEBOUNCE_MS);
  };
  const goTo = async (n: number) => {
    try { await flush(); } catch { return; }
    setIndex(n);
    assessmentsApi.savePosition(id, n).catch(() => {});
    requestAnimationFrame(() => headingRef.current?.focus());
    window.scrollTo(0, 0);
  };
  const finish = async () => {
    try { await flush(); } catch { return; }
    submit.mutate(id, {
      onSuccess: () => navigate(`/results?attempt=${id}`, { replace: true }),
      onError: () => setFinishOpen(false),
    });
  };
  const saveAndExit = async () => {
    try { await flush(); navigate("/assessment"); } catch { setExitOpen(true); }
  };

  const textLen = (draft?.text ?? "").trim().length;
  const status = saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved automatically";

  return (
    <div className="ik-assess">
      <div className="ik-assess__top">
        <button type="button" className="ik-back" onClick={saveAndExit}><Icon name="x" size={16} />Save &amp; exit</button>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-neutral-700)" }} className="hidden md:inline">{title}</span>
        <span role="status" aria-live="polite" style={{ fontSize: 13, color: saveState === "error" ? "var(--color-error)" : "var(--color-neutral-500)", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name={saveState === "error" ? "circle-alert" : "circle-check"} size={14} />{status}
        </span>
      </div>
      <div className="ik-assess__body">
        <AssessmentProgress current={index + 1} total={questions.length} section={q.section} />
        {saveError && (
          <div style={{ marginTop: 16 }}>
            <InlineAlert title="Your last answer wasn't saved">
              {saveError}{" "}
              <button type="button" className="ik-link" style={{ textDecoration: "underline" }} onClick={() => flush().catch(() => {})}>Try again</button>
            </InlineAlert>
          </div>
        )}
        {submit.error && (
          <div style={{ marginTop: 16 }}>
            <InlineAlert title="We couldn't finish the assessment">
              {errorMessage(submit.error)}
              {submit.error instanceof ApiError && submit.error.code === "ASSESSMENT_INCOMPLETE" && " Unanswered questions are marked in the overview below."}
            </InlineAlert>
          </div>
        )}
        <Card padding={32} className="ik-q-card" style={{ marginTop: 24 }}>
          <h2 id={`q-${q.id}`} ref={headingRef} tabIndex={-1} style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.45, letterSpacing: "-0.01em", textWrap: "pretty", outline: "none" }}>
            {q.text}
          </h2>
          {q.help_text && <p style={{ marginTop: 8, fontSize: 14, color: "var(--color-neutral-500)" }}>{q.help_text}</p>}
          {q.options.length ? (
            <ChoiceGroup q={q} value={draft?.option_id} onChange={choose} />
          ) : (
            <div style={{ marginTop: 24 }}>
              <Textarea
                label="Your answer"
                rows={q.type === "practical" ? 8 : 6}
                maxLength={4000}
                value={draft?.text ?? ""}
                onChange={(e) => type(e.target.value)}
                onBlur={() => flush().catch(() => {})}
                hint={textLen < q.min_length ? `Describe what you would do and why. ${q.min_length - textLen} more characters needed.` : "Thanks — you can keep adding detail."}
                placeholder={q.type === "practical" ? "The problem I noticed is…" : "I would start by…"}
              />
            </div>
          )}
        </Card>
        <div className="ik-assess__nav">
          <Button variant="secondary" size="lg" iconLeft="arrow-left" disabled={index === 0} onClick={() => goTo(index - 1)}>Back</Button>
          {isLast ? (
            <Button size="lg" iconRight="arrow-right" disabled={!answered} onClick={() => setFinishOpen(true)}>Finish</Button>
          ) : (
            <Button size="lg" iconRight="arrow-right" disabled={!answered} onClick={() => goTo(index + 1)}>Continue</Button>
          )}
        </div>
        {unanswered > 0 && (
          <details style={{ marginTop: 24, fontSize: 13, color: "var(--color-neutral-500)" }}>
            <summary style={{ cursor: "pointer" }}>{questions.length - unanswered} of {questions.length} answered · jump to a question</summary>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {questions.map((x, i) => {
                const ok = isAnswered(x, drafts[x.id]);
                return (
                  <button key={x.id} type="button" onClick={() => goTo(i)} aria-label={`Question ${i + 1}${ok ? ", answered" : ", not answered"}`}
                    aria-current={i === index ? "step" : undefined}
                    style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${i === index ? "var(--color-brand-600)" : "var(--color-neutral-200)"}`, background: ok ? "var(--color-brand-50)" : "#fff", color: ok ? "var(--color-brand-700)" : "var(--color-neutral-500)", fontSize: 12, fontWeight: 500 }}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </details>
        )}
      </div>

      <Modal open={finishOpen} onClose={() => setFinishOpen(false)} title="Finish assessment?"
        description={unanswered ? `${unanswered} question${unanswered === 1 ? " is" : "s are"} still unanswered. Answer every question before finishing.` : "Your answers will be scored and your competency profile, gaps and development plan will be generated."}
        footer={<>
          <Button variant="secondary" onClick={() => setFinishOpen(false)}>Keep answering</Button>
          <Button disabled={unanswered > 0} onClick={finish}>See my results</Button>
        </>} />
      <Modal open={exitOpen} onClose={() => setExitOpen(false)} title="Your last answer isn't saved"
        description="If you leave now, your most recent change will be lost."
        footer={<>
          <Button variant="secondary" onClick={() => setExitOpen(false)}>Stay</Button>
          <Button variant="danger" onClick={() => { pending.current = null; navigate("/assessment"); }}>Leave without saving</Button>
        </>} />
    </div>
  );
}
