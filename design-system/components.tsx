/**
 * Isker Design System — React components.
 * Ported 1:1 from the Isker DS bundle (components/*.jsx) to TypeScript. Visual output, props and
 * class names (isk-*) are unchanged. Additions are marked "Addition" and follow DESIGN_SYSTEM.md.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ICONS, type IconName } from "./icons";

/* ============================================================================================
 * Helpers
 * ========================================================================================== */

export type Level = "Foundation" | "Developing" | "Intermediate" | "Advanced" | "Proficient";
export type Gap = "High" | "Medium" | "Low";

export const LEVELS: Level[] = ["Foundation", "Developing", "Intermediate", "Advanced", "Proficient"];

/** Foundation 0–39 · Developing 40–59 · Intermediate 60–79 · Advanced 80–89 · Proficient 90–100 */
export function levelFromScore(score: number): Level {
  return score >= 90 ? "Proficient" : score >= 80 ? "Advanced" : score >= 60 ? "Intermediate" : score >= 40 ? "Developing" : "Foundation";
}

/** Gap = target − score. High ≥ 20, Medium 10–19, Low < 10. */
export function gapFromScore(score: number, target = 70): Gap {
  const g = target - score;
  return g >= 20 ? "High" : g >= 10 ? "Medium" : "Low";
}

const cx = (...c: Array<unknown>) => c.filter(Boolean).join(" ");

/* ============================================================================================
 * Core
 * ========================================================================================== */

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  label?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, color, label, style }: IconProps) {
  const Cmp = ICONS[name] ?? ICONS["circle-dot"];
  return (
    <span
      className="isk-icon-svg"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "inline-block", flex: "none", width: size, height: size, color, lineHeight: 0, ...style }}
    >
      <Cmp width="100%" height="100%" strokeWidth={2} style={{ display: "block" }} />
    </span>
  );
}

export interface CardProps extends HTMLAttributes<HTMLElement> {
  interactive?: boolean;
  padding?: number | string;
  as?: ElementType;
}

export function Card({ children, className = "", interactive = false, padding, as: Tag = "div", style, ...props }: CardProps) {
  return (
    <Tag className={cx("isk-card", interactive && "isk-card--interactive", className)} style={{ padding, ...style }} {...props}>
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
  padding?: number;
}

export function CardHeader({ title, description, action, eyebrow, padding = 24 }: CardHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <p style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--color-brand-600)", marginBottom: 4 }}>{eyebrow}</p>}
        <h3 style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--color-neutral-900)" }}>{title}</h3>
        {description && <p style={{ marginTop: 4, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", textWrap: "pretty" }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, fullWidth = false, iconLeft, iconRight, children, disabled, className = "", type = "button", ...props },
  ref,
) {
  const isz = size === "lg" ? 18 : 16;
  return (
    <button
      ref={ref}
      type={type}
      className={cx("isk-btn", `isk-btn--${variant}`, `isk-btn--${size}`, fullWidth && "isk-btn--full", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="isk-spinner" aria-hidden="true" /> : iconLeft && <Icon name={iconLeft} size={isz} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={isz} />}
    </button>
  );
});

/** Addition: a link styled as a Button (for navigation CTAs). */
export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", size = "md", fullWidth = false, iconLeft, iconRight, children, className = "", ...props },
  ref,
) {
  const isz = size === "lg" ? 18 : 16;
  return (
    <a ref={ref} className={cx("isk-btn", `isk-btn--${variant}`, `isk-btn--${size}`, fullWidth && "isk-btn--full", className)} {...props}>
      {iconLeft && <Icon name={iconLeft} size={isz} />}
      {children}
      {iconRight && <Icon name={iconRight} size={isz} />}
    </a>
  );
});

export function Tooltip({ content, children, open = false }: { content: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <span className={cx("isk-tip", open && "isk-tip--open")} tabIndex={0}>
      {children}
      <span className="isk-tip__bubble" role="tooltip">{content}</span>
    </span>
  );
}

/* ============================================================================================
 * Data
 * ========================================================================================== */

export interface LegendItem { label: string; color: string; dashed?: boolean }

export interface ChartCardProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  legend?: LegendItem[];
}

export function ChartCard({ title, description, action, summary, children, legend }: ChartCardProps) {
  return (
    <Card padding={24}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{title}</h3>
          {description && <p style={{ marginTop: 4, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>{description}</p>}
        </div>
        {action}
      </div>
      <div style={{ marginTop: 20 }}>{children}</div>
      {legend && (
        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 16 }}>
          {legend.map((l) => (
            <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", color: "var(--color-neutral-600)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: l.color, border: l.dashed ? "1.5px dashed " + l.color : 0, backgroundClip: l.dashed ? "content-box" : undefined }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {summary && (
        <p style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--color-neutral-100)", fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", lineHeight: 1.5 }}>
          {summary}
        </p>
      )}
    </Card>
  );
}

export interface CompareItem { label: string; before: number; after: number }

export function CompareBars({ items, max = 100, beforeLabel = "Before", afterLabel = "After" }: { items: CompareItem[]; max?: number; beforeLabel?: string; afterLabel?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {items.map((it) => {
        const d = it.after - it.before;
        return (
          <div key={it.label} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "6px 12px", alignItems: "center" }}>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-neutral-800)" }}>{it.label}</span>
            <span style={{ fontSize: "var(--text-sm)", fontVariantNumeric: "tabular-nums", color: "var(--color-neutral-500)", whiteSpace: "nowrap" }}>
              {it.before} → <b style={{ color: "var(--color-neutral-900)", fontWeight: 600 }}>{it.after}</b>{" "}
              <span style={{ color: d >= 0 ? "var(--color-growth-600)" : "var(--color-error)", fontWeight: 500 }}>{d >= 0 ? "+" : ""}{d}</span>
            </span>
            <div
              role="img"
              style={{ gridColumn: "1 / -1", position: "relative", height: 8, borderRadius: 9999, background: "var(--color-neutral-100)" }}
              aria-label={`${it.label}: ${beforeLabel} ${it.before}, ${afterLabel} ${it.after}`}
            >
              <div style={{ position: "absolute", inset: 0, width: (it.after / max) * 100 + "%", borderRadius: 9999, background: "var(--color-brand-600)" }} />
              <div style={{ position: "absolute", inset: 0, width: (Math.min(it.before, it.after) / max) * 100 + "%", borderRadius: 9999, background: "var(--color-brand-200)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GapBadge({ gap, score, target = 70, suffix = "gap" }: { gap?: Gap; score?: number; target?: number; suffix?: string }) {
  const g = gap || gapFromScore(score ?? 0, target);
  const k = g.toLowerCase();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 9999, padding: "4px 10px", fontSize: "var(--text-xs)", fontWeight: 500, lineHeight: "16px", background: `var(--gap-${k}-bg)`, color: `var(--gap-${k}-fg)`, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", gap: 2 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 3, height: 8, borderRadius: 1, background: "currentColor", opacity: i < (k === "high" ? 3 : k === "medium" ? 2 : 1) ? 1 : 0.25 }} />
        ))}
      </span>
      {g}
      {suffix ? " " + suffix : ""}
    </span>
  );
}

export function LevelBadge({ level, score, showDot = false }: { level?: Level | string; score?: number; showDot?: boolean }) {
  const lv = level || levelFromScore(score ?? 0);
  const k = lv.toLowerCase();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 9999, padding: "4px 10px", fontSize: "var(--text-xs)", fontWeight: 500, lineHeight: "16px", background: `var(--level-${k}-bg)`, color: `var(--level-${k}-fg)`, whiteSpace: "nowrap" }}>
      {showDot && <span style={{ width: 6, height: 6, borderRadius: 9999, background: `var(--color-level-${k})` }} />}
      {lv}
    </span>
  );
}

export interface LineSeries { values: number[]; color: string; dashed?: boolean; width?: number; label?: string }

export interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  height?: number;
  min?: number;
  max?: number;
  ticks?: number[];
  showValues?: boolean;
  ariaLabel?: string;
}

export function LineChart({ labels, series, height = 220, min = 0, max = 100, ticks = [0, 25, 50, 75, 100], showValues = true, ariaLabel = "Score history chart" }: LineChartProps) {
  const W = 600, H = height, pl = 32, pr = 16, pt = 16, pb = 28;
  const x = (i: number) => pl + (labels.length === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (labels.length - 1));
  const y = (v: number) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="var(--color-neutral-100)" />
          <text x={pl - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--color-neutral-400)" fontFamily="var(--font-sans)">{t}</text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-neutral-500)" fontFamily="var(--font-sans)">{l}</text>
      ))}
      {series.map((s, si) => (
        <g key={si}>
          <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={s.width ?? 2.5} strokeDasharray={s.dashed ? "5 5" : undefined} strokeLinecap="round" strokeLinejoin="round" />
          {!s.dashed &&
            s.values.map((v, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />
                {showValues && si === 0 && (
                  <text x={x(i)} y={y(v) - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-neutral-800)" fontFamily="var(--font-sans)">{v}</text>
                )}
              </g>
            ))}
        </g>
      ))}
    </svg>
  );
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  label?: ReactNode;
  showValue?: boolean;
  color?: string;
  height?: number;
  target?: number;
  ariaLabel?: string;
}

export function ProgressBar({ value, max = 100, label, showValue = true, color = "var(--color-brand-600)", height = 8, target, ariaLabel }: ProgressBarProps) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const tpct = target !== undefined ? Math.min(Math.max((target / max) * 100, 0), 100) : null;
  return (
    <div style={{ width: "100%" }}>
      {(label || showValue) && (
        <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", gap: 8 }}>
          {label && <span style={{ fontWeight: 500, color: "var(--color-neutral-700)" }}>{label}</span>}
          {showValue && <span style={{ color: "var(--color-neutral-500)", fontVariantNumeric: "tabular-nums" }}>{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        style={{ position: "relative", height, borderRadius: 9999, background: "var(--color-neutral-100)" }}
      >
        <div style={{ height: "100%", width: pct + "%", borderRadius: 9999, background: color, transition: "width 500ms ease" }} />
        {tpct !== null && (
          <span title={"Target " + target} style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${tpct}% - 1px)`, width: 2, borderRadius: 2, background: "var(--color-neutral-700)" }} />
        )}
      </div>
    </div>
  );
}

export interface CompetencyCardProps {
  name: string;
  area?: string;
  score: number;
  max?: number;
  level?: Level | string;
  gap?: Gap;
  target?: number;
  description?: ReactNode;
  onClick?: () => void;
  href?: string;
  notAssessed?: boolean;
}

export function CompetencyCard({ name, area, score, max = 100, level, gap, target = 70, description, onClick, href, notAssessed = false }: CompetencyCardProps) {
  const lv = level || levelFromScore((score / max) * 100);
  const gp = gap || gapFromScore((score / max) * 100, target);
  const fmt = max === 100 ? Math.round(score) : score.toFixed(1);
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          {area && <p style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--color-brand-600)" }}>{area}</p>}
          <h3 style={{ marginTop: area ? 4 : 0, fontSize: "var(--text-md)", fontWeight: 600, color: "var(--color-neutral-900)", lineHeight: 1.35, textWrap: "pretty" }}>{name}</h3>
        </div>
        {notAssessed ? (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)", whiteSpace: "nowrap" }}>Not assessed</span>
        ) : (
          <span style={{ whiteSpace: "nowrap" }}>
            <span style={{ fontSize: "var(--text-2xl)", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-neutral-900)" }}>{fmt}</span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)" }}> / {max}</span>
          </span>
        )}
      </div>
      <div style={{ marginTop: 16 }}>
        <ProgressBar value={notAssessed ? 0 : score} max={max} showValue={false} target={notAssessed ? undefined : target} ariaLabel={`${name} score`} />
      </div>
      {!notAssessed && (
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <LevelBadge level={lv} />
          <GapBadge gap={gp} />
        </div>
      )}
      {description && <p style={{ marginTop: 12, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: 1.5, textWrap: "pretty" }}>{description}</p>}
    </>
  );
  const interactive = !!(onClick || href);
  const unset: CSSProperties = { all: "unset", display: "block", width: "100%", cursor: "pointer", boxSizing: "border-box" };
  return (
    <Card interactive={interactive} padding={20} style={notAssessed ? { background: "var(--color-neutral-50)", boxShadow: "none" } : undefined}>
      {href ? (
        <a href={href} onClick={onClick ? (e: MouseEvent) => { e.preventDefault(); onClick(); } : undefined} style={unset}>{body}</a>
      ) : onClick ? (
        <button type="button" onClick={onClick} style={unset}>{body}</button>
      ) : (
        body
      )}
    </Card>
  );
}

export interface RadarAxis { label: string; short?: string; color?: string }
export interface RadarSeries { values: number[]; color: string; dashed?: boolean; fill?: string; fillOpacity?: number }

export function RadarChart({ axes, series, size = 360, max = 100, rings = 4, labelMode = "short", ariaLabel = "Competency radar chart" }: { axes: RadarAxis[]; series: RadarSeries[]; size?: number; max?: number; rings?: number; labelMode?: "short" | "full"; ariaLabel?: string }) {
  const n = axes.length, c = size / 2, r = size / 2 - 64;
  const pt = (i: number, v: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(a) * r * (v / max), c + Math.sin(a) * r * (v / max)];
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, display: "block", margin: "0 auto", overflow: "visible" }} role="img" aria-label={ariaLabel}>
      {Array.from({ length: rings }, (_, k) => (
        <polygon key={k} points={poly(axes.map(() => ((k + 1) / rings) * max))} fill="none" stroke="var(--color-neutral-200)" strokeWidth="1" />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, max);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--color-neutral-200)" strokeWidth="1" />;
      })}
      {series.map((s, si) => (
        <g key={si}>
          <polygon points={poly(s.values)} fill={s.fill ?? s.color} fillOpacity={s.fillOpacity ?? 0.12} stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? "4 4" : undefined} strokeLinejoin="round" />
          {!s.dashed &&
            s.values.map((v, i) => {
              const [x, y] = pt(i, v);
              return <circle key={i} cx={x} cy={y} r="3" fill="#fff" stroke={s.color} strokeWidth="1.5" />;
            })}
        </g>
      ))}
      {axes.map((a, i) => {
        const [x, y] = pt(i, max * 1.13);
        const anchor = Math.abs(x - c) < 6 ? "middle" : x > c ? "start" : "end";
        const lab = labelMode === "short" ? a.short || a.label : a.label;
        return (
          <text key={i} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize="11" fontWeight="500" fill={a.color || "var(--color-neutral-600)"} fontFamily="var(--font-sans)">
            {lab}
          </text>
        );
      })}
    </svg>
  );
}

export function ScoreCard({ label, score, max = 100, description, trend, level }: { label: ReactNode; score: number; max?: number; description?: ReactNode; trend?: string; level?: ReactNode }) {
  const fmt = max === 100 ? Math.round(score) : score.toFixed(1);
  return (
    <Card padding={20}>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>{label}</div>
      <div style={{ marginTop: 8, display: "flex", alignItems: "flex-end", gap: 4 }}>
        <span style={{ fontSize: "var(--text-3xl)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.1 }}>{fmt}</span>
        <span style={{ marginBottom: 3, fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>/ {max}</span>
        {level && <span style={{ marginLeft: "auto", alignSelf: "center" }}>{level}</span>}
      </div>
      {trend && <p style={{ marginTop: 8, fontSize: "var(--text-sm)", fontWeight: 500, color: trend.startsWith("-") ? "var(--color-error)" : "var(--color-growth-600)" }}>{trend}</p>}
      {description && <p style={{ marginTop: 8, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", textWrap: "pretty" }}>{description}</p>}
    </Card>
  );
}

export type Tone = "brand" | "growth" | "warning" | "neutral";

export function StatCard({ label, value, change, description, icon, tone = "brand" }: { label: ReactNode; value: ReactNode; change?: ReactNode; description?: ReactNode; icon?: IconName; tone?: Tone }) {
  const tones: Record<Tone, [string, string]> = {
    brand: ["var(--color-brand-50)", "var(--color-brand-600)"],
    growth: ["var(--color-growth-50)", "var(--color-growth-600)"],
    warning: ["var(--color-warning-bg)", "var(--color-warning)"],
    neutral: ["var(--color-neutral-100)", "var(--color-neutral-600)"],
  };
  const [bg, fg] = tones[tone] || tones.brand;
  return (
    <Card padding={20}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>{label}</p>
        {icon && (
          <span style={{ width: 32, height: 32, flex: "none", borderRadius: 8, display: "grid", placeItems: "center", background: bg, color: fg }}>
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>
      <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-2xl)", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.25, textWrap: "balance" }}>{value}</span>
        {change && <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-growth-600)" }}>{change}</span>}
      </div>
      {description && <p style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>{description}</p>}
    </Card>
  );
}

/* ============================================================================================
 * Feedback
 * ========================================================================================== */

export function AIInsight({ title = "AI insight", context, children, action, confidence }: { title?: ReactNode; context?: ReactNode; children: ReactNode; action?: ReactNode; confidence?: ReactNode }) {
  return (
    <section aria-label={typeof title === "string" ? title : "AI insight"} style={{ borderRadius: "var(--radius-lg)", border: "1px solid var(--color-brand-100)", background: "var(--color-brand-50)", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 9999, background: "var(--color-brand-600)", color: "#fff" }}>
          <Icon name="sparkles" size={14} />
        </span>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-brand-800)" }}>{title}</span>
        {context && <span style={{ fontSize: "var(--text-xs)", color: "var(--color-brand-700)", background: "#fff", border: "1px solid var(--color-brand-100)", borderRadius: 9999, padding: "2px 8px" }}>{context}</span>}
        {confidence && <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>Confidence: {confidence}</span>}
      </div>
      <div style={{ marginTop: 12, fontSize: "var(--text-sm)", lineHeight: "24px", color: "var(--color-neutral-700)", textWrap: "pretty" }}>{children}</div>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </section>
  );
}

export function EmptyState({ title, description, action, icon = "clipboard-list", tone = "brand" }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: IconName; tone?: "brand" | "error" }) {
  const err = tone === "error";
  return (
    <div role={err ? "alert" : undefined} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-lg)", border: "1px dashed var(--color-neutral-300)", background: "#fff", padding: "48px 24px", textAlign: "center" }}>
      <div style={{ display: "flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 9999, background: err ? "var(--color-error-bg)" : "var(--color-brand-50)", color: err ? "var(--color-error)" : "var(--color-brand-600)" }}>
        <Icon name={icon} size={22} />
      </div>
      <h3 style={{ marginTop: 16, fontWeight: 600, fontSize: "var(--text-md)" }}>{title}</h3>
      {description && <p style={{ marginTop: 8, maxWidth: 448, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: 1.5, textWrap: "pretty" }}>{description}</p>}
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}

export interface ModalProps {
  open?: boolean;
  onClose?: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  inline?: boolean;
}

export function Modal({ open = true, onClose, title, description, children, footer, inline = false }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open || inline) return;
    const prev = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const focusables = () => Array.from(box?.querySelectorAll<HTMLElement>("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])") ?? []).filter((el) => !el.hasAttribute("disabled"));
    (focusables().find((el) => el.tagName !== "BUTTON" || el.getAttribute("aria-label") !== "Close") ?? box)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, inline, onClose]);
  if (!open) return null;
  const box = (
    <div ref={ref} tabIndex={-1} className="isk-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h2 id={titleId} style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{title}</h2>
          {description && <p style={{ marginTop: 6, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: 1.5 }}>{description}</p>}
        </div>
        {onClose && (
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--color-neutral-400)", padding: 4, display: "flex", borderRadius: 6 }}>
            <Icon name="x" size={18} />
          </button>
        )}
      </div>
      {children && <div style={{ marginTop: 16 }}>{children}</div>}
      {footer && <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>{footer}</div>}
    </div>
  );
  if (inline) return box;
  return <div className="isk-overlay" onClick={onClose}>{box}</div>;
}

export function Skeleton({ width = "100%", height = 12, radius, circle = false, style }: { width?: number | string; height?: number; radius?: number; circle?: boolean; style?: CSSProperties }) {
  return <span className="isk-skel" aria-hidden="true" style={{ display: "block", width: circle ? height : width, height, borderRadius: circle ? 9999 : radius, ...style }} />;
}

export function SkeletonCard({ lines = 3, chart = false }: { lines?: number; chart?: boolean }) {
  return (
    <div className="isk-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true" aria-label="Loading">
      <Skeleton width="40%" height={10} />
      <Skeleton width="60%" height={16} />
      {chart ? <Skeleton height={140} radius={10} /> : <Skeleton height={8} radius={9999} />}
      {Array.from({ length: Math.max(0, lines - 2) }, (_, i) => <Skeleton key={i} width={i % 2 ? "70%" : "90%"} height={10} />)}
    </div>
  );
}

export type ToastVariant = "success" | "error" | "warning" | "info";
const TOAST: Record<ToastVariant, [IconName, string]> = {
  success: ["circle-check", "var(--color-success)"],
  error: ["circle-alert", "var(--color-error)"],
  warning: ["triangle-alert", "var(--color-warning)"],
  info: ["info", "var(--color-info)"],
};

export function Toast({ variant = "success", title, description, onClose, action }: { variant?: ToastVariant; title: ReactNode; description?: ReactNode; onClose?: () => void; action?: ReactNode }) {
  const [ic, col] = TOAST[variant];
  return (
    <div role={variant === "error" ? "alert" : "status"} style={{ display: "flex", gap: 12, alignItems: "flex-start", width: "100%", maxWidth: 380, background: "#fff", border: "1px solid var(--color-neutral-200)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: "14px 16px" }}>
      <span style={{ color: col, marginTop: 1 }}><Icon name={ic} size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-neutral-900)" }}>{title}</p>
        {description && <p style={{ marginTop: 2, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: 1.45 }}>{description}</p>}
        {action && <div style={{ marginTop: 8 }}>{action}</div>}
      </div>
      {onClose && (
        <button type="button" aria-label="Dismiss" onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--color-neutral-400)", padding: 2, display: "flex" }}>
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

/** Addition: inline alert for form and page-level messages. */
export function InlineAlert({ tone = "error", title, children }: { tone?: "error" | "info" | "success" | "warning"; title?: ReactNode; children?: ReactNode }) {
  const icon: IconName = tone === "error" ? "circle-alert" : tone === "success" ? "circle-check" : tone === "warning" ? "triangle-alert" : "info";
  return (
    <div className={`isk-alert isk-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} size={16} style={{ marginTop: 2 }} />
      <div>
        {title && <p style={{ fontWeight: 600 }}>{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** Addition: small status pill (activity / resource state). Text is always shown — colour is never the only signal. */
export function StatusBadge({ status, children }: { status: "done" | "progress" | "todo" | "locked" | "recommended"; children: ReactNode }) {
  const map = {
    done: ["var(--color-growth-50)", "var(--color-growth-700)", "check"],
    progress: ["var(--color-brand-50)", "var(--color-brand-700)", "circle-dot"],
    todo: ["var(--color-neutral-100)", "var(--color-neutral-600)", undefined],
    locked: ["var(--color-neutral-100)", "var(--color-neutral-500)", "lock"],
    recommended: ["var(--color-brand-50)", "var(--color-brand-700)", "sparkles"],
  } as const;
  const [bg, fg, ic] = map[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 9999, padding: "3px 9px", fontSize: "var(--text-xs)", fontWeight: 500, lineHeight: "16px", background: bg, color: fg, whiteSpace: "nowrap" }}>
      {ic && <Icon name={ic} size={12} />}
      {children}
    </span>
  );
}

/* ============================================================================================
 * Forms
 * ========================================================================================== */

export interface CheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckProps>(function Checkbox({ label, description, className = "", ...props }, ref) {
  return (
    <label className={cx("isk-check", className)}>
      <input ref={ref} type="checkbox" {...props} />
      <span>
        {label}
        {description && <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>{description}</span>}
      </span>
    </label>
  );
});

export interface FieldProps {
  label?: string;
  hint?: ReactNode;
  error?: ReactNode;
}

const fieldId = (prefix: string, label: string | undefined, id: string | undefined, auto: string) => id || (label ? `${prefix}-${label.toLowerCase().replace(/\W+/g, "-")}-${auto}` : auto);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldProps {
  success?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, success, id, className = "", ...props }, ref) {
  const auto = useId();
  const fid = fieldId("f", label, id, auto);
  const hintId = `${fid}-hint`;
  const state = error ? "isk-input--error" : success ? "isk-input--success" : "";
  return (
    <div className="isk-field">
      {label && <label className="isk-label" htmlFor={fid}>{label}</label>}
      <input ref={ref} id={fid} className={cx("isk-input", state, className)} aria-invalid={!!error || undefined} aria-describedby={error || success || hint ? hintId : undefined} {...props} />
      {(error || success || hint) && (
        <span id={hintId} className={cx("isk-hint", error ? "isk-hint--error" : success ? "isk-hint--success" : "")}>{error || success || hint}</span>
      )}
    </div>
  );
});

export const Radio = forwardRef<HTMLInputElement, CheckProps>(function Radio({ label, description, className = "", ...props }, ref) {
  return (
    <label className={cx("isk-check", className)}>
      <input ref={ref} type="radio" {...props} />
      <span>
        {label}
        {description && <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>{description}</span>}
      </span>
    </label>
  );
});

export interface AnswerOptionProps {
  label: ReactNode;
  checked?: boolean;
  onSelect?: () => void;
  index?: number;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const AnswerOption = forwardRef<HTMLButtonElement, AnswerOptionProps>(function AnswerOption({ label, checked = false, onSelect, index, tabIndex, onKeyDown }, ref) {
  return (
    <button ref={ref} type="button" role="radio" aria-checked={checked} className="isk-choice" onClick={onSelect} tabIndex={tabIndex} onKeyDown={onKeyDown}>
      <span className="isk-choice__dot" />
      <span style={{ flex: 1 }}>{label}</span>
      {index !== undefined && <span aria-hidden="true" style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", fontWeight: 500 }}>{String.fromCharCode(65 + index)}</span>}
    </button>
  );
});

export interface SelectOption { value: string; label: string }

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldProps {
  options?: Array<string | SelectOption>;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, options = [], placeholder, id, className = "", ...props }, ref) {
  const auto = useId();
  const fid = fieldId("s", label, id, auto);
  const hintId = `${fid}-hint`;
  return (
    <div className="isk-field">
      {label && <label className="isk-label" htmlFor={fid}>{label}</label>}
      <select ref={ref} id={fid} className={cx("isk-input", error && "isk-input--error", className)} aria-invalid={!!error || undefined} aria-describedby={error || hint ? hintId : undefined} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      {(error || hint) && <span id={hintId} className={cx("isk-hint", error && "isk-hint--error")}>{error || hint}</span>}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, hint, error, id, rows = 4, maxLength, value, className = "", ...props }, ref) {
  const auto = useId();
  const fid = fieldId("t", label, id, auto);
  const hintId = `${fid}-hint`;
  const count = typeof value === "string" ? value.length : null;
  return (
    <div className="isk-field">
      {label && <label className="isk-label" htmlFor={fid}>{label}</label>}
      <textarea ref={ref} id={fid} rows={rows} maxLength={maxLength} value={value} className={cx("isk-input", error && "isk-input--error", className)} aria-invalid={!!error || undefined} aria-describedby={hintId} {...props} />
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span id={hintId} className={cx("isk-hint", error && "isk-hint--error")}>{error || hint}</span>
        {maxLength && count !== null && <span className="isk-hint" aria-live="polite">{count} / {maxLength}</span>}
      </span>
    </div>
  );
});

/* ============================================================================================
 * Learning
 * ========================================================================================== */

export function AssessmentProgress({ current, total, section }: { current: number; total: number; section?: string }) {
  const pct = (current / total) * 100;
  return (
    <div style={{ width: "100%" }}>
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Question {current} of {total}
          {section && <span style={{ color: "var(--color-neutral-400)", fontWeight: 400 }}> · {section}</span>}
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", fontVariantNumeric: "tabular-nums" }}>{Math.round(pct)}%</span>
      </div>
      <ProgressBar value={current} max={total} showValue={false} ariaLabel={`Question ${current} of ${total}`} />
    </div>
  );
}

export type PlanStepKind = "gap" | "learn" | "practice" | "reflect" | "reassess";
export type PlanStepStatus = "todo" | "current" | "done" | "locked";
const STEP: Record<PlanStepKind, [IconName, string]> = {
  gap: ["target", "Your gap"],
  learn: ["book-open", "Learn"],
  practice: ["pencil-ruler", "Practice"],
  reflect: ["message-square-text", "Reflect"],
  reassess: ["refresh-cw", "Reassess"],
};

export function PlanStep({ step, title, meta, action, status = "todo", last = false, children }: { step: PlanStepKind; title?: ReactNode; meta?: ReactNode; action?: ReactNode; status?: PlanStepStatus; last?: boolean; children?: ReactNode }) {
  const [ic, lab] = STEP[step];
  const done = status === "done", locked = status === "locked";
  const statusText = done ? "Completed" : locked ? "Locked" : status === "current" ? "Current step" : "Not started";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "36px minmax(0,1fr)", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span style={{ width: 36, height: 36, borderRadius: 9999, display: "grid", placeItems: "center", flex: "none", background: done ? "var(--color-growth-50)" : locked ? "var(--color-neutral-100)" : "var(--color-brand-50)", color: done ? "var(--color-growth-600)" : locked ? "var(--color-neutral-400)" : "var(--color-brand-600)", border: status === "current" ? "1.5px solid var(--color-brand-600)" : "1.5px solid transparent" }}>
          <Icon name={done ? "check" : locked ? "lock" : ic} size={16} />
        </span>
        {!last && <span style={{ flex: 1, width: 2, minHeight: 16, background: done ? "var(--color-growth-200)" : "var(--color-neutral-200)", margin: "4px 0" }} />}
      </div>
      <div style={{ paddingBottom: last ? 0 : 24, minWidth: 0 }}>
        <p style={{ fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: locked ? "var(--color-neutral-400)" : "var(--color-neutral-500)", marginTop: 2 }}>
          {lab}
          <span className="isk-sr-only"> — {statusText}</span>
        </p>
        {title && <p style={{ marginTop: 4, fontSize: "var(--text-md)", fontWeight: 600, color: locked ? "var(--color-neutral-500)" : "var(--color-neutral-900)", textWrap: "pretty" }}>{title}</p>}
        {meta && <p style={{ marginTop: 4, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>{meta}</p>}
        {children}
        {action && <div style={{ marginTop: 12 }}>{action}</div>}
      </div>
    </div>
  );
}

export interface RecommendationCardProps {
  competency: string;
  title: ReactNode;
  description?: ReactNode;
  duration?: string;
  difficulty?: string;
  type?: string;
  current?: number;
  target?: number;
  gap?: Gap;
  practice?: { title: string; duration: string };
  onStart?: () => void;
  cta?: string;
  reason?: ReactNode;
}

export function RecommendationCard({ competency, title, description, duration, difficulty, type = "Learn", current, target, gap, practice, onStart, cta = "Start activity", reason }: RecommendationCardProps) {
  const meta = [type, duration, difficulty].filter(Boolean);
  return (
    <Card style={{ overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--color-brand-600)" }}>Recommended for {competency}</span>
          {gap ? <GapBadge gap={gap} suffix="priority" /> : <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)" }}>{duration}</span>}
        </div>
        {current !== undefined && (
          <p style={{ marginTop: 12, fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", fontVariantNumeric: "tabular-nums" }}>
            <b style={{ color: "var(--color-neutral-900)", fontWeight: 600 }}>{current}</b> → {target} target
          </p>
        )}
        <h3 style={{ marginTop: 10, fontSize: "var(--text-lg)", fontWeight: 600, lineHeight: 1.35, textWrap: "pretty" }}>{title}</h3>
        {description && <p style={{ marginTop: 8, fontSize: "var(--text-sm)", lineHeight: "24px", color: "var(--color-neutral-600)", textWrap: "pretty" }}>{description}</p>}
        {gap && meta.length > 0 && (
          <p style={{ marginTop: 10, fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", display: "flex", gap: 6, alignItems: "center" }}>
            <Icon name="clock" size={13} />
            {meta.join(" · ")}
          </p>
        )}
        {practice && (
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--color-neutral-50)", border: "1px solid var(--color-neutral-100)" }}>
            <p style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--color-neutral-500)" }}>Practice</p>
            <p style={{ marginTop: 2, fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-neutral-800)" }}>
              {practice.title} <span style={{ color: "var(--color-neutral-400)", fontWeight: 400 }}>· {practice.duration}</span>
            </p>
          </div>
        )}
        {reason && (
          <p style={{ marginTop: 12, fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", display: "flex", gap: 6, lineHeight: 1.5 }}>
            <Icon name="info" size={13} style={{ marginTop: 2 }} />
            {reason}
          </p>
        )}
        {onStart && (
          <div style={{ marginTop: "auto", paddingTop: 20 }}>
            <Button onClick={onStart}>{cta}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ============================================================================================
 * Navigation
 * ========================================================================================== */

export interface NavEntry { id: string; label: string; icon: IconName; href?: string }

export const ISKER_NAV: NavEntry[] = [
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { id: "assessment", label: "Assessment", icon: "clipboard-check" },
  { id: "competencies", label: "Competencies", icon: "radar" },
  { id: "development-plan", label: "Development Plan", icon: "route" },
  { id: "learning", label: "Learning", icon: "library" },
  { id: "practice", label: "Practice", icon: "pencil-ruler" },
  { id: "progress", label: "Progress", icon: "trending-up" },
];

export const ISKER_NAV_FOOTER: NavEntry[] = [
  { id: "profile", label: "Profile", icon: "user" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export const ISKER_BOTTOM_NAV: NavEntry[] = [
  { id: "dashboard", label: "Home", icon: "layout-dashboard" },
  { id: "assessment", label: "Assess", icon: "clipboard-check" },
  { id: "competencies", label: "Profile", icon: "radar" },
  { id: "development-plan", label: "Develop", icon: "route" },
  { id: "progress", label: "Progress", icon: "trending-up" },
];

export interface NavItemProps {
  icon?: IconName | ReactNode;
  label: ReactNode;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  badge?: ReactNode;
}

export function NavItem({ icon, label, active = false, onClick, href, badge }: NavItemProps) {
  const content = (
    <>
      {icon && (typeof icon === "string" ? <Icon name={icon} size={18} /> : icon)}
      <span className="isk-nav-item__label" style={{ flex: 1 }}>{label}</span>
      {badge && <span className="isk-nav-item__badge" style={{ fontSize: 11, fontWeight: 600, background: active ? "#fff" : "var(--color-neutral-100)", color: "var(--color-neutral-600)", borderRadius: 9999, padding: "1px 7px" }}>{badge}</span>}
    </>
  );
  const cls = cx("isk-nav-item", active && "isk-nav-item--active");
  if (href) {
    return (
      <a href={href} title={typeof label === "string" ? label : undefined} aria-current={active ? "page" : undefined} className={cls} onClick={onClick ? (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onClick(); } : undefined}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} title={typeof label === "string" ? label : undefined} aria-current={active ? "page" : undefined} className={cls}>
      {content}
    </button>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="isk-wordmark" style={{ fontSize: size, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--color-neutral-900)" }}>
      I<span className="isk-wordmark__rest">sker</span>
    </span>
  );
}

export interface SidebarProps {
  items?: NavEntry[];
  footerItems?: NavEntry[];
  active?: string;
  onNavigate?: (id: string) => void;
  hrefFor?: (id: string) => string;
  footer?: ReactNode;
  user?: { name: string; role?: string; initials: string };
}

export function Sidebar({ items = ISKER_NAV, footerItems = ISKER_NAV_FOOTER, active, onNavigate, hrefFor, footer, user }: SidebarProps) {
  return (
    <aside className="isk-sidebar" aria-label="Main navigation">
      <div className="isk-sidebar__brand" style={{ padding: "4px 12px 20px" }}>
        <Wordmark />
      </div>
      <nav aria-label="Primary" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((it) => (
          <NavItem key={it.id} icon={it.icon} label={it.label} active={active === it.id} href={hrefFor?.(it.id) ?? it.href} onClick={() => onNavigate?.(it.id)} />
        ))}
      </nav>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {footer}
        {footerItems.map((it) => (
          <NavItem key={it.id} icon={it.icon} label={it.label} active={active === it.id} href={hrefFor?.(it.id) ?? it.href} onClick={() => onNavigate?.(it.id)} />
        ))}
        {user && (
          <a href={hrefFor?.("profile")} className="isk-sidebar__user" onClick={(e) => { e.preventDefault(); onNavigate?.("profile"); }} title={user.name}>
            <span className="isk-avatar">{user.initials}</span>
            <span className="isk-sidebar__user-text" style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-neutral-900)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</span>
              {user.role && <span style={{ display: "block", fontSize: 12, color: "var(--color-neutral-500)" }}>{user.role}</span>}
            </span>
          </a>
        )}
      </div>
    </aside>
  );
}

export function BottomNav({ items = ISKER_BOTTOM_NAV, active, onNavigate, hrefFor, fixed = true }: { items?: NavEntry[]; active?: string; onNavigate?: (id: string) => void; hrefFor?: (id: string) => string; fixed?: boolean }) {
  return (
    <nav className="isk-bottom-nav" aria-label="Main navigation" style={fixed ? undefined : { position: "relative" }}>
      {items.map((it) => (
        <a
          key={it.id}
          href={hrefFor?.(it.id) ?? it.href ?? "#"}
          aria-current={active === it.id ? "page" : undefined}
          className={cx("isk-bottom-nav__item", active === it.id && "isk-bottom-nav__item--active")}
          style={{ textDecoration: "none" }}
          onClick={(e) => { e.preventDefault(); onNavigate?.(it.id); }}
        >
          <Icon name={it.icon} size={20} />
          {it.label}
        </a>
      ))}
    </nav>
  );
}

export interface TabDef { value: string; label: string }

export function Tabs({ tabs, value, onChange, variant = "pill", ariaLabel }: { tabs: Array<string | TabDef>; value: string; onChange?: (v: string) => void; variant?: "pill" | "line"; ariaLabel?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx("isk-tabs", variant === "line" && "isk-tabs--line")}>
      {tabs.map((t) => {
        const id = typeof t === "string" ? t : t.value;
        const lab = typeof t === "string" ? t : t.label;
        return (
          <button key={id} role="tab" type="button" aria-selected={value === id} className="isk-tab" onClick={() => onChange?.(id)}>
            {lab}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================================
 * Layout & content (Additions — promoted from the UI-kit Shell so pages don't re-implement them)
 * ========================================================================================== */

export function PageHeader({ title, subtitle, action, eyebrow, back }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; eyebrow?: ReactNode; back?: { label: string; onClick?: () => void; href?: string } }) {
  return (
    <div className="ik-page-head">
      <div style={{ minWidth: 0 }}>
        {back && (
          <a className="ik-back" href={back.href ?? "#"} onClick={(e) => { if (back.onClick) { e.preventDefault(); back.onClick(); } }}>
            <Icon name="arrow-left" size={16} />
            {back.label}
          </a>
        )}
        {eyebrow && <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-brand-600)", marginBottom: 6 }}>{eyebrow}</p>}
        <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.25, textWrap: "balance" }}>{title}</h1>
        {subtitle && <p style={{ marginTop: 6, fontSize: 14, color: "var(--color-neutral-500)", textWrap: "pretty" }}>{subtitle}</p>}
      </div>
      {action && <div className="ik-page-head__action">{action}</div>}
    </div>
  );
}

export function SectionTitle({ title, description, action, as: Tag = "h2" }: { title: ReactNode; description?: ReactNode; action?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
      <div>
        <Tag style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{title}</Tag>
        {description && <p style={{ marginTop: 4, fontSize: 14, color: "var(--color-neutral-500)" }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Addition: renders a small, safe Markdown subset (## headings, paragraphs, lists, **bold**, *italic*). No HTML injection. */
export function Prose({ source }: { source: string }) {
  const inline = (text: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let last = 0, m: RegExpExecArray | null, i = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const tok = m[0];
      out.push(tok.startsWith("**") ? <strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong> : <em key={`${key}-${i++}`}>{tok.slice(1, -1)}</em>);
      last = m.index + tok.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r/g, "").split("\n");
  let para: string[] = [], list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) { blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>); para = []; }
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={`o${blocks.length}`}>{items}</ol> : <ul key={`u${blocks.length}`}>{items}</ul>);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    const ul = /^[-*]\s+(.*)$/.exec(line), ol = /^\d+\.\s+(.*)$/.exec(line);
    if (!line) { flush(); continue; }
    if (line.startsWith("### ")) { flush(); blocks.push(<h3 key={`h${blocks.length}`}>{inline(line.slice(4), `h${blocks.length}`)}</h3>); continue; }
    if (line.startsWith("## ")) { flush(); blocks.push(<h2 key={`h${blocks.length}`}>{inline(line.slice(3), `h${blocks.length}`)}</h2>); continue; }
    if (ul || ol) {
      if (para.length) { const p = para; para = []; blocks.push(<p key={`p${blocks.length}`}>{inline(p.join(" "), `p${blocks.length}`)}</p>); }
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (list) flush();
    para.push(line);
  }
  flush();
  return <div className="isk-prose">{blocks}</div>;
}

/** Addition: the score hero ("72 / 100"). Scores are the visual hero: 36–48/600 with a quiet "/ 100". */
export function ScoreValue({ value, max = 100, size = 48, label }: { value: number | null | undefined; max?: number; size?: number; label?: string }) {
  return (
    <div className="ik-score" aria-label={label ? `${label}: ${value ?? "not measured"} out of ${max}` : undefined}>
      <span className="ik-score__value" style={{ fontSize: size }}>{value ?? "—"}</span>
      <span className="ik-score__max" style={{ fontSize: size >= 40 ? 16 : 13 }}>/ {max}</span>
    </div>
  );
}
