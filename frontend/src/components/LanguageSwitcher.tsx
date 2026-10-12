import { LanguageSelect } from "@isker/design-system";
import { useTranslation } from "react-i18next";
import type { Language } from "../i18n/config";
import { useLanguage } from "../i18n/useLanguage";

/** Language selector used on public pages, auth pages, the app shell and the admin shell. */
export function LanguageSwitcher({ compact = true }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { language, setLanguage, options } = useLanguage();
  return <LanguageSelect compact={compact} label={t("language.choose")} value={language} options={options} onChange={(v) => setLanguage(v as Language)} />;
}
