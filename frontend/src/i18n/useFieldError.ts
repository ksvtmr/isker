import { useTranslation } from "react-i18next";

/**
 * Translates form error messages. Zod schemas use translation keys ("common:validation.emailInvalid");
 * messages that are not keys (e.g. a server field error) are shown as they are.
 */
export function useFieldError() {
  const { t } = useTranslation();
  return (msg: string | undefined | null) => (msg ? t(msg, { defaultValue: msg }) : undefined);
}
