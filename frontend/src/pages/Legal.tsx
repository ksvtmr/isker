import { Card, PageHeader } from "@isker/design-system";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const UPDATED = "October 2026";

function LegalFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px 80px" }}>
      <p style={{ marginBottom: 16 }}><Link to="/">← Isker</Link></p>
      <PageHeader title={title} subtitle={`Last updated: ${UPDATED}`} />
      <Card padding={28}><div className="isk-prose">{children}</div></Card>
    </main>
  );
}

export function TermsPage() {
  return (
    <LegalFrame title="Terms of Use">
      <h2>What Isker is</h2>
      <p>Isker is an educational platform that helps you assess and develop entrepreneurial competencies based on the EntreComp framework. Results are developmental guidance, not a professional, psychological or hiring evaluation.</p>
      <h2>Your account</h2>
      <ul>
        <li>Give accurate information and keep your password private. You are responsible for activity in your account.</li>
        <li>You can close your account at any time in Settings. Closed accounts can be restored by support; permanent deletion is done on request.</li>
        <li>We may suspend accounts that abuse the service, attack it, or harm other people. We record the reason.</li>
      </ul>
      <h2>Plans</h2>
      <p>The Free plan includes the core journey: assessment, results, a development plan, learning and practice, with the limits shown on the <Link to="/plans">plans page</Link>. Paid plans can currently be granted by an administrator; online payment is not yet available.</p>
      <h2>AI feedback</h2>
      <p>Some feedback is generated automatically. It can be wrong. Use it as one input among others.</p>
      <h2>Acceptable use</h2>
      <p>Don't try to access other people's data, disrupt the service, or submit unlawful content.</p>
      <h2>Changes</h2>
      <p>If these terms change in a meaningful way, we will ask you to accept the new version.</p>
    </LegalFrame>
  );
}

export function PrivacyPage() {
  return (
    <LegalFrame title="Privacy Policy">
      <h2>What we store</h2>
      <ul>
        <li>Account data: name, email, a salted password hash (never the password itself), roles and account status.</li>
        <li>Learning data: profile answers, goals, assessment answers and scores, plan, learning and practice progress.</li>
        <li>Security data: sign-in sessions (device description and IP address) and an audit log of security-relevant actions.</li>
      </ul>
      <h2>Why</h2>
      <p>To run your assessment and development plan, keep your account secure, and understand how the platform is used in aggregate.</p>
      <h2>Who can see it</h2>
      <p>Only you and authorised staff with a specific role (for example support or administrators). Staff access is permission-based and logged. Staff can never see your password.</p>
      <h2>AI processing</h2>
      <p>When an AI provider is configured, the text of open answers and practice submissions is sent to it to generate feedback. When none is configured, feedback is produced by a built-in rule-based evaluator.</p>
      <h2>Your choices</h2>
      <ul>
        <li>Download your data from Settings (data export).</li>
        <li>Close your account from Settings, or ask support to delete it permanently.</li>
      </ul>
      <h2>Cookies</h2>
      <p>Isker uses two strictly necessary cookies: a sign-in session cookie and a security token that protects forms against cross-site requests. There are no advertising or tracking cookies.</p>
    </LegalFrame>
  );
}
