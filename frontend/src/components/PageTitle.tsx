import { PageHeader as DSPageHeader } from "@isker/design-system";
import { useEffect, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

/**
 * Sets the browser tab title to "<Page> · Isker" in the interface language (re-applied on language change).
 * Pages without a PageHeader (sign-in, assessment runner…) call it directly.
 */
export function usePageTitle(title: string | null | undefined) {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = title ? t("common:app.pageTitle", { page: title }) : t("common:app.name");
  }, [title, t, i18n.language]);
}

type DSProps = ComponentProps<typeof DSPageHeader>;

/** The design-system PageHeader that also names the browser tab. `docTitle` is used when `title` is not plain text. */
export function PageHeader({ docTitle, ...props }: DSProps & { docTitle?: string }) {
  usePageTitle(docTitle ?? (typeof props.title === "string" ? props.title : null));
  return <DSPageHeader {...props} />;
}
