import { Card, Icon, Wordmark, type IconName } from "@isker/design-system";
import { LinkButton } from "../components/RouterLink";
import { Link } from "react-router-dom";
import { useMe } from "../api/auth";

const LOOP: [IconName, string][] = [
  ["clipboard-check", "Assess"], ["radar", "Profile"], ["target", "Identify gaps"], ["sparkles", "Recommend"],
  ["book-open", "Learn"], ["pencil-ruler", "Practice"], ["refresh-cw", "Re-assess"], ["trending-up", "Track progress"],
];

const FEATURES: [IconName, string, string][] = [
  ["clipboard-check", "Evidence-based assessment", "30 questions across self-assessment, situations, open answers and a practical task — mapped to the 15 EntreComp competencies."],
  ["target", "Gaps you can act on", "Every score is explained, compared with your target and ranked by how much it matters for your goals."],
  ["route", "A plan, not a quiz", "Each priority gap becomes a Learn → Practice → Reflect → Reassess plan, so you can measure real development."],
];

export function Landing() {
  const { data: user } = useMe();
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-neutral-50)" }}>
      <header className="ik-landing-top">
        <Wordmark size={22} />
        <nav aria-label="Account" style={{ display: "flex", gap: 8 }}>
          {user ? (
            <LinkButton to="/dashboard" iconRight="arrow-right">Open dashboard</LinkButton>
          ) : (
            <>
              <LinkButton to="/login" variant="ghost">Sign in</LinkButton>
              <LinkButton to="/register">Create account</LinkButton>
            </>
          )}
        </nav>
      </header>
      <main>
        <section className="ik-landing-hero">
          <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-brand-600)" }}>EntreComp · 15 competencies</p>
          <h1 style={{ marginTop: 12, fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.15, maxWidth: 760, textWrap: "balance" }}>
            Measure and develop your entrepreneurial competencies
          </h1>
          <p style={{ marginTop: 16, fontSize: 17, lineHeight: 1.6, color: "var(--color-neutral-600)", maxWidth: 640 }}>
            Isker assesses how you spot opportunities, use resources and turn ideas into action — then builds a personal plan
            and shows how you grow over time.
          </p>
          <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <LinkButton to={user ? "/assessment" : "/register"} size="lg" iconRight="arrow-right">Start assessment</LinkButton>
            {!user && <LinkButton to="/login" size="lg" variant="secondary">I have an account</LinkButton>}
          </div>
          <ol className="ik-loop" aria-label="How Isker works" style={{ marginTop: 40, listStyle: "none", padding: 0 }}>
            {LOOP.map(([icon, label], i) => (
              <li key={label} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="ik-loop__step"><Icon name={icon} size={14} />{label}</span>
                {i < LOOP.length - 1 && <span aria-hidden="true" style={{ color: "var(--color-neutral-400)" }}>→</span>}
              </li>
            ))}
          </ol>
        </section>
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px 72px" }} aria-label="Features">
          <div className="ik-grid3">
            {FEATURES.map(([icon, title, text]) => (
              <Card key={title} padding={24}>
                <span style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--color-brand-50)", color: "var(--color-brand-600)" }}>
                  <Icon name={icon} size={18} />
                </span>
                <h2 style={{ marginTop: 16, fontSize: 16, fontWeight: 600 }}>{title}</h2>
                <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-600)" }}>{text}</p>
              </Card>
            ))}
          </div>
          <p style={{ marginTop: 32, fontSize: 13, color: "var(--color-neutral-500)" }}>
            Diploma MVP · Astana IT University. <Link to="/login">Sign in</Link> with the demo account to explore a complete profile.
          </p>
        </section>
      </main>
    </div>
  );
}
