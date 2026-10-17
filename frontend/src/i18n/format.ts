/** Locale-aware formatting through Intl, always following the current interface language. */
import { currentLocaleTag } from "./index";

/**
 * Some browsers and WebViews ship without Kazakh locale data; Intl then silently formats in English
 * ("Oct 17, 2026"). For dates we fall back to Kazakh month names; for numbers and currency to ru-RU, which uses
 * the same separators as Kazakh (space for thousands, comma for decimals).
 */
const supported = new Map<string, boolean>();
function isSupported(tag: string): boolean {
  if (!supported.has(tag)) {
    let ok = false;
    try {
      ok = Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0
        && new Intl.DateTimeFormat(tag).resolvedOptions().locale.split("-")[0] === tag.split("-")[0];
    } catch {
      ok = false;
    }
    supported.set(tag, ok);
  }
  return supported.get(tag)!;
}

function numberTag(): string {
  const tag = currentLocaleTag();
  return tag.startsWith("kk") && !isSupported(tag) ? "ru-RU" : tag;
}

const KK_MONTHS_LONG = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];
const KK_MONTHS_SHORT = ["қаң.", "ақп.", "нау.", "сәу.", "мам.", "мау.", "шіл.", "там.", "қыр.", "қаз.", "қар.", "жел."];

/** Kazakh date in CLDR order ("2026 ж. 17 қазан, 08:06") for engines without kk data. */
function formatKazakhDate(d: Date, opts: Intl.DateTimeFormatOptions): string {
  const parts: string[] = [];
  if (opts.year) parts.push(`${d.getFullYear()} ж.`);
  if (opts.day) parts.push(String(d.getDate()));
  if (opts.month) {
    const m = d.getMonth();
    parts.push(opts.month === "long" ? KK_MONTHS_LONG[m] : opts.month === "short" || opts.month === "narrow" ? KK_MONTHS_SHORT[m] : String(m + 1).padStart(2, "0"));
  }
  let out = parts.join(" ");
  if (opts.hour) {
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    out = out ? `${out}, ${time}` : time;
  }
  return out;
}

export function formatDate(iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const tag = currentLocaleTag();
  if (tag.startsWith("kk") && !isSupported(tag)) return formatKazakhDate(d, opts);
  return new Intl.DateTimeFormat(tag, opts).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(numberTag(), opts).format(n);
}

/** `value` is a percentage (e.g. 66.7 → "66,7 %" in Russian). */
export function formatPercent(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(numberTag(), { style: "percent", maximumFractionDigits }).format(value / 100);
}

export function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat(numberTag(), { style: "currency", currency }).format(cents / 100);
}

/** Exposed for tests. */
export const __formatKazakhDate = formatKazakhDate;
