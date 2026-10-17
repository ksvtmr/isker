/**
 * Build-time configuration (Vite env). Nothing here is a secret.
 *  - VITE_SUPPORT_EMAIL: public support address. When unset, no address is shown (never a placeholder that
 *    looks real); pages show only the in-app guidance.
 *  - VITE_SHOW_DEMO=true: mention the demo account on the landing page (demo/staging deployments only).
 */
const env = import.meta.env as Record<string, string | undefined>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function supportEmail(): string | null {
  const v = env.VITE_SUPPORT_EMAIL?.trim();
  return v && EMAIL_RE.test(v) ? v : null;
}

export function showDemo(): boolean {
  return env.VITE_SHOW_DEMO === "true";
}
