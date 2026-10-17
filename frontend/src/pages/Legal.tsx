import { Card } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supportEmail } from "../config";
import { formatDate } from "../utils/format";

/** Date of the current version of both documents. */
const UPDATED = new Date(2026, 9, 1);

function LegalFrame({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation("public");
  const email = supportEmail();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px 80px" }}>
      <p style={{ marginBottom: 16 }}><Link to="/"><span aria-hidden="true">← </span>{t("legal.backHome")}</Link></p>
      <PageHeader title={title} subtitle={t("legal.lastUpdated", { date: formatDate(UPDATED, { month: "long", year: "numeric" }) })} />
      <Card padding={28}>
        <div className="isk-prose">
          {children}
          <h2>{t("legal.contactTitle")}</h2>
          {email
            ? <p>{t("legal.contactText")} <a href={`mailto:${email}`}>{email}</a>.</p>
            : <p>{t("legal.contactInApp")}</p>}
        </div>
      </Card>
    </main>
  );
}

export function TermsPage() {
  const { t } = useTranslation("public");
  return (
    <LegalFrame title={t("terms.title")}>
      <h2>{t("terms.whatTitle")}</h2>
      <p>{t("terms.whatText")}</p>
      <h2>{t("terms.accountTitle")}</h2>
      <ul>
        <li>{t("terms.accountAccurate")}</li>
        <li>{t("terms.accountClose")}</li>
        <li>{t("terms.accountSuspend")}</li>
      </ul>
      <h2>{t("terms.plansTitle")}</h2>
      <p><Trans t={t} i18nKey="terms.plansText" components={{ plansLink: <Link to="/plans" /> }} /></p>
      <h2>{t("terms.aiTitle")}</h2>
      <p>{t("terms.aiText")}</p>
      <h2>{t("terms.useTitle")}</h2>
      <p>{t("terms.useText")}</p>
      <h2>{t("terms.changesTitle")}</h2>
      <p>{t("terms.changesText")}</p>
    </LegalFrame>
  );
}

export function PrivacyPage() {
  const { t } = useTranslation("public");
  return (
    <LegalFrame title={t("privacy.title")}>
      <h2>{t("privacy.storeTitle")}</h2>
      <ul>
        <li>{t("privacy.storeAccount")}</li>
        <li>{t("privacy.storeLearning")}</li>
        <li>{t("privacy.storeSecurity")}</li>
      </ul>
      <h2>{t("privacy.whyTitle")}</h2>
      <p>{t("privacy.whyText")}</p>
      <h2>{t("privacy.whoTitle")}</h2>
      <p>{t("privacy.whoText")}</p>
      <h2>{t("privacy.aiTitle")}</h2>
      <p>{t("privacy.aiText")}</p>
      <h2>{t("privacy.choicesTitle")}</h2>
      <ul>
        <li>{t("privacy.choicesExport")}</li>
        <li>{t("privacy.choicesClose")}</li>
      </ul>
      <h2>{t("privacy.cookiesTitle")}</h2>
      <p>{t("privacy.cookiesText")}</p>
    </LegalFrame>
  );
}
