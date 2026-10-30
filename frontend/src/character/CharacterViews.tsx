import { Card, EmptyState, Icon, ProgressBar } from "@isker/design-system";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCharacter, useMarkStageSeen } from "../api/character";
import { LinkButton } from "../components/RouterLink";
import type { Character, CharacterStage, StageEvent } from "../types/api";
import { formatDate } from "../utils/format";
import { CharacterAvatar } from "./CharacterAvatar";
import { STAGE_KEYS, STAGES, type CharacterState } from "./config";

function useStageName() {
  const { t } = useTranslation("character");
  return (s: CharacterStage) => t(`stages.${STAGE_KEYS[s]}.name`);
}

/** "Stage 2 of 4" chips, so the stage never relies on colour alone. */
export function StageSteps({ current }: { current: CharacterStage | null }) {
  const { t } = useTranslation("character");
  const name = useStageName();
  return (
    <ol className="ik-char-stages" aria-label={t("panel.stagesAria")}>
      {STAGES.map((s) => (
        <li key={s} aria-current={s === current ? "step" : undefined} data-done={current !== null && s < current}>
          {current !== null && s < current && <Icon name="check" size={12} />}
          <span>{s}. {name(s)}</span>
        </li>
      ))}
    </ol>
  );
}

/** What the stage rests on, in words (assessment coverage, confirmed practice, the rule version). */
export function StageBasis({ c }: { c: Character }) {
  const { t } = useTranslation("character");
  const b = c.basis;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: "var(--color-neutral-600)" }}>
      <li>{t("basis.assessment", { score: c.assessment_score ?? "—", assessed: b.competencies_assessed, total: b.competencies_total })}</li>
      <li>{c.practice_counted
        ? t("basis.practiceCounted", { count: c.practice_tasks, score: c.practice_score ?? "—", weight: Math.round(b.practice_weight * 100) })
        : t("basis.practiceNotYet", { count: c.practice_tasks, min: b.practice_min_tasks })}</li>
      <li>{t("basis.lessons")}</li>
    </ul>
  );
}

function RuleDetails({ c }: { c: Character }) {
  const { t } = useTranslation("character");
  const name = useStageName();
  return (
    <details style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-600)" }}>
      <summary style={{ cursor: "pointer", color: "var(--color-brand-700)", fontWeight: 500 }}>{t("panel.howTitle")}</summary>
      <p style={{ marginTop: 8, lineHeight: 1.55 }}>{t("panel.howText", { weight: Math.round(c.basis.practice_weight * 100), min: c.basis.practice_min_tasks })}</p>
      <ul style={{ marginTop: 6, paddingLeft: 18, lineHeight: 1.6 }}>
        {c.bands.map((b) => <li key={b.stage}>{t("panel.band", { name: name(b.stage), min: b.min, max: b.max })}</li>)}
      </ul>
      <p style={{ marginTop: 6 }}>{t("panel.preliminary", { version: c.rules_version })}</p>
    </details>
  );
}

/**
 * Dashboard and results: the character of the current stage, how far the next one is, what it rests on, and the next
 * step. The no-assessment and not-enough-data states are explicit; no stage is invented.
 */
export function CharacterPanel({ c, state = "idle", focus, action, children }: {
  c: Character; state?: CharacterState; focus?: { name: string } | null; action?: ReactNode; children?: ReactNode;
}) {
  const { t } = useTranslation("character");
  const name = useStageName();
  if (c.status !== "ready" || !c.stage) {
    const none = c.status === "no_assessment";
    return (
      <Card padding={24}>
        <div className="ik-char-panel">
          <div className="ik-char-panel__art"><CharacterAvatar stage={null} size={150} /></div>
          <div className="ik-char-panel__body">
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{none ? t("panel.noAssessmentTitle") : t("panel.insufficientTitle")}</h2>
            <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.55, color: "var(--color-neutral-600)" }}>{none ? t("panel.noAssessmentText") : t("panel.insufficientText")}</p>
            <div style={{ marginTop: 16 }}>{action ?? <LinkButton to="/assessment" iconRight="arrow-right">{none ? t("panel.takeAssessment") : t("panel.reassess")}</LinkButton>}</div>
          </div>
        </div>
      </Card>
    );
  }
  const stage = c.stage;
  const next = c.next_stage;
  return (
    <Card padding={24}>
      <div className="ik-char-panel">
        <div className="ik-char-panel__art"><CharacterAvatar stage={stage} state={state} size="lg" /></div>
        <div className="ik-char-panel__body">
          <p style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>{t("panel.eyebrow")}</p>
          <h2 style={{ marginTop: 4, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {name(stage)} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-neutral-500)" }}>· {t("avatar.stageOf", { n: stage, total: 4 })}</span>
          </h2>
          <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.55, color: "var(--color-neutral-700)" }}>{t(`stages.${STAGE_KEYS[stage]}.description`)}</p>
          <div style={{ marginTop: 14 }}><StageSteps current={stage} /></div>
          <div style={{ marginTop: 16 }}>
            {next ? (
              <ProgressBar value={c.progress_pct ?? 0} color="var(--color-growth-500)" height={8}
                label={t("panel.toNext", { count: c.points_to_next ?? 0, next: name(next) })}
                ariaLabel={t("avatar.progressAria", { pct: c.progress_pct ?? 0, next: name(next) })} />
            ) : <p style={{ fontSize: 14, color: "var(--color-growth-700)", fontWeight: 500 }}>{t("panel.topStage")}</p>}
          </div>
          {focus && <p style={{ marginTop: 12, fontSize: 14, color: "var(--color-neutral-700)" }}><b>{t("panel.recommendation")}</b> {t("panel.focus", { name: focus.name })}</p>}
          <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-500)" }}>{t("panel.notWorth")}</p>
          {children}
          <RuleDetails c={c} />
          {action && <div style={{ marginTop: 16 }}>{action}</div>}
        </div>
      </div>
    </Card>
  );
}

/**
 * Shows a stage change the API has already confirmed and stored, once: the event is marked as shown on the server
 * as soon as it is displayed, so a reload does not congratulate again. Not a modal: work continues around it.
 */
export function StageChangeNotice() {
  const { t } = useTranslation("character");
  const name = useStageName();
  const { data } = useCharacter();
  const markSeen = useMarkStageSeen();
  const [event, setEvent] = useState<StageEvent | null>(null);
  const [closed, setClosed] = useState(false);
  const marked = useRef<number | null>(null);
  const pending = data?.pending_event ?? null;

  useEffect(() => {
    if (!pending || marked.current === pending.id) return;
    marked.current = pending.id;
    setEvent(pending);
    setClosed(false);
    markSeen.mutate(pending.id);
  }, [pending, markSeen]);

  if (!event || closed) return null;
  const up = event.direction === "up";
  return (
    <div className="ik-char-notice" data-direction={event.direction} role="status" aria-live="polite" style={{ marginBottom: 24 }}>
      <CharacterAvatar stage={event.stage} state={up ? "celebrating" : "supportive"} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-neutral-900)" }}>
          {up ? t("notice.upTitle", { name: name(event.stage) }) : t("notice.downTitle", { name: name(event.stage) })}
        </p>
        <p style={{ marginTop: 4, fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-700)" }}>
          {up
            ? t("notice.upText", { from: event.previous_stage ? name(event.previous_stage) : "—", score: event.score, description: t(`stages.${STAGE_KEYS[event.stage]}.short`) })
            : t("notice.downText", { score: event.score })}
        </p>
      </div>
      <button type="button" className="ik-back" onClick={() => setClosed(true)} aria-label={t("notice.close")}><Icon name="x" size={16} /></button>
    </div>
  );
}

/** Learning, practice and assessment: a small character in the screen's state, next to the current goal. */
export function CharacterAside({ state, goal, title, note }: { state: CharacterState; goal?: string | null; title?: string; note?: string }) {
  const { t } = useTranslation("character");
  const name = useStageName();
  const { data: c } = useCharacter();
  // The stage shown here is fixed while the screen is open: answering questions never changes it.
  const frozen = useRef<CharacterStage | null | undefined>(undefined);
  if (frozen.current === undefined && c) frozen.current = c.status === "ready" ? c.stage : null;
  const stage = frozen.current ?? null;
  if (!c) return null;
  return (
    <div className="ik-char-aside">
      <CharacterAvatar stage={stage} state={state} size="xs" />
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-neutral-800)" }}>{title ?? (stage ? name(stage) : t("avatar.noStageShort"))}</p>
        {goal && <p style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{t("aside.goal", { goal })}</p>}
        {note && <p style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{note}</p>}
        <p className="isk-sr-only" aria-live="polite">{t(`states.${state}`)}</p>
      </div>
    </div>
  );
}

/** Progress page: confirmed stage changes with their dates, kept apart from the current state. */
export function StageHistory() {
  const { t } = useTranslation("character");
  const name = useStageName();
  const { data: c } = useCharacter();
  if (!c) return null;
  if (c.status !== "ready" || !c.stage) {
    return <EmptyState icon="user" title={t("history.emptyTitle")} description={t("history.emptyText")} />;
  }
  const events = [...c.history].reverse();
  return (
    <Card padding={24}>
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <CharacterAvatar stage={c.stage} state="idle" size="sm" />
        <div style={{ minWidth: 0, flex: "1 1 240px" }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("history.title")}</h2>
          <p style={{ marginTop: 4, fontSize: 14, color: "var(--color-neutral-700)" }}>
            {t("history.current", { name: name(c.stage), score: c.score ?? "—" })}
          </p>
          <p style={{ marginTop: 2, fontSize: 12, color: "var(--color-neutral-500)" }}>{t("history.difference")}</p>
        </div>
      </div>
      <ol className="ik-char-history" style={{ marginTop: 12 }} aria-label={t("history.title")}>
        {events.map((e) => (
          <li key={e.id} className="ik-list-row">
            <span style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
              <span aria-hidden="true" style={{ width: 32, height: 32, flex: "none", borderRadius: 8, display: "grid", placeItems: "center", background: e.direction === "up" ? "var(--color-growth-50)" : "var(--color-brand-50)", color: e.direction === "up" ? "var(--color-growth-600)" : "var(--color-brand-600)" }}>
                <Icon name={e.direction === "up" ? "trending-up" : e.direction === "down" ? "refresh-cw" : "flag"} size={16} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>
                  {e.direction === "initial" ? t("history.initial", { name: name(e.stage) })
                    : t(`history.${e.direction}`, { from: e.previous_stage ? name(e.previous_stage) : "—", name: name(e.stage) })}
                </span>
                <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>
                  {t(`history.trigger.${e.trigger}`)} · {t("history.score", { score: e.score })}
                </span>
              </span>
            </span>
            <span style={{ fontSize: 12, color: "var(--color-neutral-500)", whiteSpace: "nowrap" }}>{formatDate(e.confirmed_at)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
