/** Locale-aware formatting through Intl, always following the current interface language. */
import { currentLocaleTag } from "./index";

export function formatDate(iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(currentLocaleTag(), opts).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocaleTag(), opts).format(n);
}

/** `value` is a percentage (e.g. 66.7 → "66,7 %" in Russian). */
export function formatPercent(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(currentLocaleTag(), { style: "percent", maximumFractionDigits }).format(value / 100);
}

export function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat(currentLocaleTag(), { style: "currency", currency }).format(cents / 100);
}
