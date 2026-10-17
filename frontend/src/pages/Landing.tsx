import { Card, Icon, Wordmark, type IconName } from "@isker/design-system";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useMe } from "../api/auth";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { LinkButton } from "../components/RouterLink";
import { showDemo, supportEmail } from "../config";
import { usePageTitle } from "../components/PageTitle";


export function Landing() {
  const { t } = useTranslation("public");
  const { data: user } = useMe();
  usePageTitle(null);
  const email = supportEmail();

  const loop: [IconName, string][] = [
    ["clipboard-check", t("landing.loop.assess")], ["radar", t("landing.loop.profile")], ["target", t("landing.loop.gaps")],
    ["sparkles", t("landing.loop.recommend")], ["book-open", t("landing.loop.learn")], ["pencil-ruler", t("landing.loop.practice")],
    ["refresh-cw", t("landing.loop.reassess")], ["trending-up", t("landing.loop.track")],
  ];
  const features: [IconName, string, string][] = [
    ["clipboard-check", t("landing.features.assessmentTitle"), t("landing.features.assessmentText")],
    ["target", t("landing.features.gapsTitle"), t("landing.features.gapsText")],
    ["route", t("landing.features.planTitle"), t("landing.features.planText")],
  ];
  const faq: [string, string][] = [
    [t("landing.faq.whatIsQ"), t("landing.faq.whatIsA")],
    [t("landing.faq.freeQ"), t("landing.faq.freeA")],
    [t("landing.faq.durationQ"), t("landing.faq.durationA")],
    [t("landing.faq.privacyQ"), t("landing.faq.privacyA")],
    [t("landing.faq.languagesQ"), t("landing.faq.languagesA")],
  ];
  const muted = { color: "var(--color-neutral-600)" };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-neutral-50)" }}>
      <header className="ik-landing-top">
        <Wordmark size={22} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <LanguageSwitcher />
          <nav aria-label={t("landing.accountNav")} style={{ display: "flex", gap: 8 }}>
            {user ? (
              <LinkButton to="/dashboard" iconRight="arrow-right">{t("landing.openDashboard")}</LinkButton>
            ) : (
              <>
                <LinkButton to="/login" variant="ghost">{t("common:actions.signIn")}</LinkButton>
                <LinkButton to="/register">{t("landing.createAccount")}</LinkButton>
              </>
            )}
          </nav>
        </div>
      </header>
      <main>
        <section className="ik-landing-hero">
          <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-brand-600)" }}>{t("landing.eyebrow")}</p>
          <h1 style={{ marginTop: 12, fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.15, maxWidth: 760, textWrap: "balance" }}>
            {t("landing.title")}
          </h1>
          <p style={{ marginTop: 16, fontSize: 17, lineHeight: 1.6, maxWidth: 640, ...muted }}>{t("landing.lead")}</p>
          <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <LinkButton to={user ? "/assessment" : "/register"} size="lg" iconRight="arrow-right">{t("landing.startAssessment")}</LinkButton>
            {!user && <LinkButton to="/login" size="lg" variant="secondary">{t("landing.haveAccount")}</LinkButton>}
          </div>
          <ol className="ik-loop" aria-label={t("landing.loopAria")} style={{ marginTop: 40, listStyle: "none", padding: 0 }}>
            {loop.map(([icon, label], i) => (
              <li key={icon} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="ik-loop__step"><Icon name={icon} size={14} />{label}</span>
                {i < loop.length - 1 && <span aria-hidden="true" style={{ color: "var(--color-neutral-400)" }}>→</span>}
              </li>
            ))}
          </ol>
        </section>
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px 48px" }} aria-label={t("landing.featuresAria")}>
          <div className="ik-grid3">
            {features.map(([icon, title, text]) => (
              <Card key={icon} padding={24}>
                <span style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--color-brand-50)", color: "var(--color-brand-600)" }}>
                  <Icon name={icon} size={18} />
                </span>
                <h2 style={{ marginTop: 16, fontSize: 16, fontWeight: 600 }}>{title}</h2>
                <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6, ...muted }}>{text}</p>
              </Card>
            ))}
          </div>
        </section>
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px 48px" }} aria-labelledby="landing-faq">
          <h2 id="landing-faq" style={{ fontSize: "var(--text-xl)", fontWeight: 600, letterSpacing: "-0.01em" }}>{t("landing.faq.title")}</h2>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
            {faq.map(([q, a]) => (
              <Card key={q} padding={20}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>{q}</h3>
                <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6, ...muted }}>{a}</p>
              </Card>
            ))}
          </div>
        </section>
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px 72px" }} aria-labelledby="landing-contact">
          <h2 id="landing-contact" style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{t("landing.contact.title")}</h2>
          <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6, ...muted }}>
            {email ? <>{t("landing.contact.text")} <a href={`mailto:${email}`}>{email}</a></> : t("landing.contact.inApp")}
          </p>
          <nav aria-label={t("landing.contact.legalNav")} style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
            <Link to="/terms">{t("landing.contact.terms")}</Link>
            <Link to="/privacy">{t("landing.contact.privacy")}</Link>
          </nav>
          <p style={{ marginTop: 32, fontSize: 13, color: "var(--color-neutral-500)" }}>
            {t("landing.footnote")}
            {showDemo() && <>{" "}<Trans t={t} i18nKey="landing.demoNote" components={{ signInLink: <Link to="/login" /> }} /></>}
          </p>
        </section>
      </main>
    </div>
  );
}
