import { Badge, Button, Card, CardHeader, Icon, InlineAlert } from "@isker/design-system";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAnalysis, useRunAnalysis } from "../api/assessments";
import { errorMessage } from "../api/client";
import { currentLanguage } from "../i18n";
import type { AnalysisAction, AnalysisState } from "../types/api";
import { LinkButton } from "./RouterLink";

const LANG_NAME: Record<string, string> = { ru: "Русский", kk: "Қазақша", en: "English" };

function ActionLink({ a }: { a: AnalysisAction }) {
  const { t } = useTranslation("assessment");
  if (a.kind === "learn" && a.resource) {
    return a.resource.available
      ? <LinkButton to={`/learning/${a.resource.id}`} size="sm" variant="secondary">{a.resource.title}</LinkButton>
      : <span className="isk-hint">{a.resource.title} · {t("analysis.notAvailable")}</span>;
  }
  if (a.kind === "practice" && a.task) {
    return a.task.available
      ? <LinkButton to={`/practice/${a.task.id}`} size="sm" variant="secondary">{a.task.title}</LinkButton>
      : <span className="isk-hint">{a.task.title} · {t("analysis.notAvailable")}</span>;
  }
  return null;
}

function Body({ s, compact }: { s: AnalysisState; compact: boolean }) {
  const { t } = useTranslation("assessment");
  const a = s.analysis!;
  const minutes = (x: AnalysisAction) => x.resource?.minutes ?? x.task?.minutes;
  const actions = compact ? a.recommended_actions.slice(0, 3) : a.recommended_actions;
  return (
    <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <p style={{ margin: 0, lineHeight: 1.6 }}>{a.summary}</p>

      {!compact && a.strengths.length > 0 && (
        <section aria-labelledby="an-strengths">
          <h3 id="an-strengths" className="ik-h3">{t("analysis.strengths")}</h3>
          <ul className="ik-plain-list">
            {a.strengths.map((x) => (
              <li key={x.code}><b>{x.name}</b>{x.score !== null && <> · {x.score}/100</>} — {x.explanation}</li>
            ))}
          </ul>
        </section>
      )}

      {a.development_areas.length > 0 && (
        <section aria-labelledby="an-areas">
          <h3 id="an-areas" className="ik-h3">{t("analysis.priorities")}</h3>
          <ol className="ik-plain-list">
            {a.development_areas.map((x) => (
              <li key={x.code}><b>{x.name}</b>{x.score !== null && <> · {x.score}/100</>}{!compact && <> — {x.explanation}</>}</li>
            ))}
          </ol>
        </section>
      )}

      {actions.length > 0 && (
        <section aria-labelledby="an-actions">
          <h3 id="an-actions" className="ik-h3">{t("analysis.actions")}</h3>
          <ul className="ik-plain-list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {actions.map((x, i) => (
              <li key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span>
                  <Badge tone={x.kind === "learn" ? "info" : x.kind === "practice" ? "success" : "neutral"}>{t(`analysis.kind.${x.kind}`)}</Badge>{" "}
                  <b>{x.competency.name}</b>{minutes(x) ? <> · {t("common:time.minutes", { count: minutes(x) })}</> : null}
                </span>
                <span>{x.reason}</span>
                <span><ActionLink a={x} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!compact && a.milestones.length > 0 && (
        <section aria-labelledby="an-milestones">
          <h3 id="an-milestones" className="ik-h3">{t("analysis.milestones")}</h3>
          <ul className="ik-plain-list">
            {a.milestones.map((m, i) => (
              <li key={i}><b>{m.objective}</b> — {m.measure} ({t("analysis.inWeeks", { count: m.target_weeks })})</li>
            ))}
          </ul>
        </section>
      )}

      {!compact && a.confidence_notes.length > 0 && (
        <InlineAlert tone="info" title={t("analysis.confidence")}>
          <ul className="ik-plain-list" style={{ margin: 0 }}>{a.confidence_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </InlineAlert>
      )}

      {a.reassessment_weeks && (
        <p className="isk-hint" style={{ margin: 0 }}>
          <Icon name="calendar-clock" size={14} /> {t("analysis.reassessIn", { count: a.reassessment_weeks })}
        </p>
      )}
    </div>
  );
}

/**
 * AI development analysis of one completed attempt: requested automatically the first time, with pending, failed
 * (retry) and success states. Texts are shown in the language they were written in; the learner can have them
 * written again in the current interface language.
 */
export function AnalysisPanel({ attemptId, compact = false }: { attemptId: number; compact?: boolean }) {
  const { t } = useTranslation("assessment");
  const q = useAnalysis(attemptId);
  const run = useRunAnalysis(attemptId);
  const asked = useRef(false);
  const s = q.data;

  useEffect(() => {
    if (!compact && s?.status === "none" && !asked.current) {
      asked.current = true;
      run.mutate(false);
    }
  }, [compact, s?.status, run]);

  const lang = currentLanguage();
  const busy = run.isPending || s?.status === "pending" || (!compact && s?.status === "none");
  const source = s?.rule_based ? t("analysis.ruleBased") : s?.model ? t("analysis.model", { model: s.model }) : undefined;

  let content;
  if (q.isLoading) content = null;
  else if (q.error) content = <div style={{ padding: "0 24px 24px" }}><InlineAlert>{errorMessage(q.error)}</InlineAlert></div>;
  else if (busy) {
    content = (
      <p role="status" aria-live="polite" style={{ padding: "0 24px 24px", margin: 0, display: "flex", gap: 10, alignItems: "center" }}>
        <span className="isk-spinner" aria-hidden="true" style={{ borderColor: "var(--color-brand-200)", borderTopColor: "var(--color-brand-600)" }} />
        {t("analysis.pending")}
      </p>
    );
  } else if (s?.status === "failed" || run.error) {
    content = (
      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <InlineAlert title={t("analysis.failedTitle")}>
          {run.error ? errorMessage(run.error) : t(`analysis.error.${s?.error_code ?? "provider_unavailable"}`, { defaultValue: t("analysis.error.provider_unavailable") })}
          {" "}{t("analysis.resultsKept")}
        </InlineAlert>
        <div><Button iconLeft="refresh-cw" onClick={() => run.mutate(false)}>{t("analysis.retry")}</Button></div>
      </div>
    );
  } else if (s?.status === "none") {
    content = (
      <div style={{ padding: "0 24px 24px" }}>
        <LinkButton to={`/results?attempt=${attemptId}`} variant="secondary" size="sm">{t("analysis.open")}</LinkButton>
      </div>
    );
  } else if (s?.status === "succeeded" && s.analysis) {
    content = (
      <>
        {s.error_code && (
          <div style={{ padding: "0 24px 12px" }}>
            <InlineAlert tone="warning">{t("analysis.rewriteFailed")} {t(`analysis.error.${s.error_code}`, { defaultValue: "" })}</InlineAlert>
          </div>
        )}
        {s.language && s.language !== lang && (
          <div style={{ padding: "0 24px 12px" }}>
            <InlineAlert tone="info">
              {t("analysis.otherLanguage", { language: LANG_NAME[s.language] ?? s.language })}{" "}
              <Button size="sm" variant="secondary" onClick={() => run.mutate(true)}>{t("analysis.rewrite")}</Button>
            </InlineAlert>
          </div>
        )}
        <Body s={s} compact={compact} />
        {compact && (
          <div style={{ padding: "0 24px 24px" }}>
            <LinkButton to={`/results?attempt=${attemptId}`} variant="secondary" size="sm" iconRight="arrow-right">{t("analysis.open")}</LinkButton>
          </div>
        )}
      </>
    );
  }

  return (
    <Card>
      <div id="analysis">
        <CardHeader eyebrow={source} title={t("analysis.title")} description={t("analysis.disclaimer")} />
        {content}
      </div>
    </Card>
  );
}
