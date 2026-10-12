import { EmptyState } from "@isker/design-system";
import { useTranslation } from "react-i18next";
import { useMe } from "../api/auth";
import { LinkButton } from "../components/RouterLink";

export function NotFound() {
  const { t } = useTranslation("public");
  const { data: user } = useMe();
  return (
    <main style={{ maxWidth: 560, margin: "15vh auto 0", padding: 16 }}>
      <EmptyState
        icon="search-x"
        title={t("common:state.notFoundTitle")}
        description={t("common:state.notFoundText")}
        action={user ? <LinkButton to="/dashboard">{t("common:actions.goToDashboard")}</LinkButton> : <LinkButton to="/">{t("notFound.home")}</LinkButton>}
      />
    </main>
  );
}

/** Not-found content inside an existing layout (e.g. the admin shell). */
export function NotFoundInline() {
  const { t } = useTranslation();
  return <EmptyState icon="search-x" title={t("common:state.notFoundTitle")} description={t("common:state.adminNotFoundText")} action={<LinkButton to="/admin">{t("common:state.adminDashboard")}</LinkButton>} />;
}
