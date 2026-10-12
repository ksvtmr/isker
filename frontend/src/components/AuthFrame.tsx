import { Card, Wordmark } from "@isker/design-system";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Centered card layout shared by sign-in, registration and account-recovery pages. */
export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="ik-auth">
      <main className="ik-auth__box">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Link to="/" aria-label="Isker home" style={{ textDecoration: "none" }}><Wordmark size={26} /></Link>
        </div>
        <Card padding={28}>
          <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>{title}</h1>
          {subtitle && <p style={{ marginTop: 4, fontSize: 14, color: "var(--color-neutral-500)" }}>{subtitle}</p>}
          <div style={{ marginTop: 24 }}>{children}</div>
        </Card>
        {footer && <p style={{ marginTop: 16, textAlign: "center", fontSize: 14, color: "var(--color-neutral-600)" }}>{footer}</p>}
      </main>
    </div>
  );
}
