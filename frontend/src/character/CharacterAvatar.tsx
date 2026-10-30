import { ProgressBar } from "@isker/design-system";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { CharacterStage } from "../types/api";
import { assetFor, MORPH_MS, SIZES, STAGE_KEYS, type CharacterSize, type CharacterState } from "./config";
import { usePrefersReducedMotion } from "./hooks";

export interface CharacterAvatarProps {
  /** Stage from the API. null: no stage yet (a neutral silhouette, never an invented level). */
  stage: CharacterStage | null;
  state?: CharacterState;
  /** Height of the figure: a preset or pixels. Small sizes show head and shoulders. */
  size?: CharacterSize | number;
  /** Allow motion (state reactions, the stage morph). The system reduce-motion setting always wins. */
  animated?: boolean;
  showLabel?: boolean;
  /** Progress towards the next stage (0–100) and its name; shown under the figure when provided. */
  showProgress?: boolean;
  progress?: { pct: number; nextStage: CharacterStage | null } | null;
  /** Force reduced motion (otherwise prefers-reduced-motion decides). */
  reducedMotion?: boolean;
  /** Override the bust crop that small sizes use. */
  crop?: "full" | "bust";
  className?: string;
}

/**
 * One illustration of the learner's character. Stage and state come from the caller (stage from the API, state from
 * the screen's context); the component never computes a stage. One animation runs at a time: a stage change morphs
 * (≈700 ms), otherwise the current state's short animation plays once.
 */
export function CharacterAvatar({
  stage, state = "idle", size = "md", animated = true, showLabel = false, showProgress = false, progress = null,
  reducedMotion, crop, className = "",
}: CharacterAvatarProps) {
  const { t } = useTranslation("character");
  const systemReduced = usePrefersReducedMotion();
  const still = reducedMotion ?? systemReduced;
  const motion = animated && !still;
  const height = typeof size === "number" ? size : SIZES[size];
  const bust = crop ? crop === "bust" : height < 120;

  // Stage morph: keep the previous stage on screen while the new one fades in, then drop it.
  const [previous, setPrevious] = useState<CharacterStage | null>(null);
  const last = useRef(stage);
  useEffect(() => {
    if (last.current === stage) return;
    const from = last.current;
    last.current = stage;
    if (!motion || from === null || stage === null) return;
    setPrevious(from);
    const id = setTimeout(() => setPrevious(null), MORPH_MS);
    return () => clearTimeout(id);
  }, [stage, motion]);

  const [failed, setFailed] = useState<string | null>(null);
  const src = stage ? assetFor(stage, state) : assetFor(1, "idle");
  const missing = !src || failed === src;

  const stageName = stage ? t(`stages.${STAGE_KEYS[stage]}.name`) : null;
  const label = stage
    ? t("avatar.label", { stage: stageName, n: stage, state: t(`states.${state}`) })
    : t("avatar.noStage");
  const anim = !motion ? "none" : previous !== null ? "morph" : state;
  const box: CSSProperties = { height, width: bust ? height : Math.round(height * (200 / 280)) };

  return (
    <div className={`ik-char ${className}`} data-stage={stage ?? "none"} data-state={state}>
      <div role="img" aria-label={label} className={`ik-char__figure${bust ? " ik-char__figure--bust" : ""}${stage ? "" : " ik-char__figure--empty"}`} style={box}>
        {missing ? (
          <span className="ik-char__fallback" aria-hidden="true">{stage ?? "?"}</span>
        ) : (
          <>
            {previous !== null && (
              <img key={`prev-${previous}`} className="ik-char__img ik-char__img--out" src={assetFor(previous, state)} alt="" aria-hidden="true" draggable={false} />
            )}
            <img
              key={`${stage}-${state}`}
              className="ik-char__img"
              data-anim={anim}
              src={src}
              alt=""
              aria-hidden="true"
              draggable={false}
              onError={() => setFailed(src ?? null)}
            />
          </>
        )}
      </div>
      {showLabel && (
        <p className="ik-char__label">
          {stage ? <><span className="ik-char__step">{t("avatar.stageOf", { n: stage, total: 4 })}</span>{stageName}</> : t("avatar.noStageShort")}
        </p>
      )}
      {showProgress && progress && stage && (
        <div className="ik-char__progress">
          {progress.nextStage ? (
            <ProgressBar value={progress.pct} showValue={false} height={6} color="var(--color-growth-500)"
              ariaLabel={t("avatar.progressAria", { pct: progress.pct, next: t(`stages.${STAGE_KEYS[progress.nextStage]}.name`) })} />
          ) : <p className="ik-char__hint">{t("avatar.topStage")}</p>}
        </div>
      )}
    </div>
  );
}
