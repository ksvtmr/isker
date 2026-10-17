/**
 * i18next setup. All translations are bundled (no runtime machine translation, no network fetch).
 * Language priority (see docs/localization.md):
 *   1. the signed-in user's saved preference (applied by useLanguageSync after /api/auth/me)
 *   2. the language chosen in this browser (localStorage "isker.lang")
 *   3. the browser language, if supported
 *   4. Russian
 */
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LANGUAGE, LANGUAGES, LOCALE_TAGS, NAMESPACES, STORAGE_KEY, toLanguage, type Language } from "./config";
import { resources } from "./resources";

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: [...NAMESPACES],
    defaultNS: "common",
    supportedLngs: [...LANGUAGES],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    // Kazakh falls back to Russian, then English; key parity is enforced by tests, so this is a safety net only.
    fallbackLng: { kk: ["ru", "en"], ru: ["en"], en: ["ru"], default: [DEFAULT_LANGUAGE] },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: STORAGE_KEY,
      caches: ["localStorage"],
      convertDetectedLanguage: (lng: string) => toLanguage(lng) ?? DEFAULT_LANGUAGE,
    },
    interpolation: { escapeValue: false }, // React escapes output
    returnNull: false,
    returnEmptyString: false,
    react: { useSuspense: false },
  });

/** <html lang> and the meta description follow the interface language (index.html ships the Russian default). */
function applyDocumentLanguage(lng: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = toLanguage(lng) ?? DEFAULT_LANGUAGE;
  const meta = document.querySelector('meta[name="description"]');
  if (meta && i18n.isInitialized) meta.setAttribute("content", i18n.t("common:app.metaDescription"));
}
applyDocumentLanguage(i18n.language);
void i18nReady.then(() => applyDocumentLanguage(i18n.language));
i18n.on("languageChanged", applyDocumentLanguage);

export function currentLanguage(): Language {
  return toLanguage(i18n.resolvedLanguage ?? i18n.language) ?? DEFAULT_LANGUAGE;
}

export function currentLocaleTag(): string {
  return LOCALE_TAGS[currentLanguage()];
}

export default i18n;

// Development only: an edited translation file is swapped in place (no full page reload, form state is kept).
if (import.meta.hot) {
  import.meta.hot.accept("./resources", (mod) => {
    if (!mod) return;
    for (const [lng, namespaces] of Object.entries((mod as unknown as typeof import("./resources")).resources)) {
      for (const [ns, data] of Object.entries(namespaces)) i18n.addResourceBundle(lng, ns, data, true, true);
    }
    void i18n.changeLanguage(i18n.language); // re-renders every component that uses t()
  });
}
