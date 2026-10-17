import { Icon } from "@isker/design-system";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/** Visible icon + screen-reader text telling that a link opens in a new tab. */
export function NewTabHint() {
  const { t } = useTranslation();
  return (
    <>
      <span className="isk-sr-only"> {t("common:a11y.opensInNewTab")}</span>
      <span aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "-2px", marginLeft: 3 }}><Icon name="external-link" size={13} /></span>
    </>
  );
}

/** External link opened in a new tab, announced as such. */
export function ExternalLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}<NewTabHint /></a>;
}

/** In-app route opened in a new tab (e.g. Terms from the registration form, so the form is kept). */
export function NewTabRouteLink({ to, children }: { to: string; children?: ReactNode }) {
  return <Link to={to} target="_blank" rel="noopener">{children}<NewTabHint /></Link>;
}
