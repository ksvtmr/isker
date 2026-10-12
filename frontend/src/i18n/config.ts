/** Supported interface languages. Russian is the default for new visitors. */
export const LANGUAGES = ["ru", "kk", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "ru";

/** Shown in the language selector in their own language (never as flags only). */
export const LANGUAGE_NAMES: Record<Language, string> = { ru: "Русский", kk: "Қазақша", en: "English" };

/** BCP 47 tags for Intl formatting (dates, numbers, currencies, plural rules). */
export const LOCALE_TAGS: Record<Language, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };

/** localStorage key for the anonymous visitor's choice (only the language code is stored). */
export const STORAGE_KEY = "isker.lang";

export const NAMESPACES = ["common", "errors", "auth", "public", "subscriptions", "dashboard", "assessment", "learning", "account", "admin", "adminContent"] as const;
export type Namespace = (typeof NAMESPACES)[number];

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);
}

/** Normalises "ru-RU", "kk", "EN-gb" … to a supported language, or null. */
export function toLanguage(v: string | null | undefined): Language | null {
  if (!v) return null;
  const base = v.toLowerCase().split(/[-_]/)[0];
  if (base === "kz") return "kk";
  return isLanguage(base) ? base : null;
}
