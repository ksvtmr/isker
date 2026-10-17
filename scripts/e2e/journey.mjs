/**
 * End-to-end check against a running Isker (API + built SPA on one origin).
 *
 *   BASE=http://localhost:8000 ADMIN_EMAIL=admin@isker.local ADMIN_PASSWORD=... node journey.mjs [screenshot-dir]
 *
 * Covers: registration with terms, onboarding, the full assessment → results → plan → learning → practice loop,
 * plan limits, the learner being kept out of the admin area, admin user management (grant plan, suspend,
 * reactivate) with audit entries, and an in-browser axe-core run (WCAG 2.2 A/AA incl. colour contrast).
 * Exit code is non-zero if any step fails or axe reports violations.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const AXE_SOURCE = require("fs").readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const B = process.env.BASE ?? "http://localhost:8000";
const OUT = process.argv[2] ?? "e2e-shots";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@isker.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "IskerAdmin2026";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROMIUM });
const results = { steps: [], axe: [] };
let failed = false;

async function newPage(viewport = { width: 1440, height: 900 }) {
  // bypassCSP only lets the test inject axe-core; the app itself is served with its normal CSP.
  const ctx = await browser.newContext({ viewport, bypassCSP: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  return page;
}

async function step(page, name, fn) {
  try {
    await fn();
    results.steps.push({ name, ok: true });
    console.log("OK  ", name);
  } catch (e) {
    failed = true;
    results.steps.push({ name, ok: false, error: e.message.split("\n")[0] });
    console.log("FAIL", name, "-", e.message.split("\n")[0]);
    await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }).catch(() => {});
  }
}

async function axe(page, label) {
  await page.waitForLoadState("networkidle");
  await page.addScriptTag({ content: AXE_SOURCE });
  const res = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations
      .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} :: ${n.html.slice(0, 160)} :: ${(n.any[0]?.message ?? "").slice(0, 160)}`) })));
  results.axe.push({ page: label, violations: res });
  if (res.length) failed = true;
  console.log(res.length ? "AXE " : "A11Y", label, res.length ? JSON.stringify(res) : "no violations");
}

// This journey reads English labels. A signed-in account's saved language wins over the browser (by design), so
// the seeded accounts are switched to English first.
async function useEnglish(page, email, password) {
  await page.goto(B + "/login");
  await page.evaluate(async ([e, p]) => {
    await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) });
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("isker_csrf="))?.split("=")[1] ?? "";
    await fetch("/api/auth/me/language", { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ language: "en" }) });
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrf } });
  }, [email, password]);
  await page.context().clearCookies();
}

async function login(page, email, password) {
  await page.goto(B + "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const ANSWER = "First I would list my assumptions and test the riskiest one. I would interview ten customers about the problem, build a free landing page as a cheap prototype, measure sign-ups and learn from the result. Students struggle with this; customers would pay a small fee per order, which covers the cost and gives a margin.";
const email = `e2e${Date.now()}@example.com`;
const learner = await newPage();

await step(learner, "registration requires accepting the terms", async () => {
  await learner.goto(B + "/register");
  await axe(learner, "/register");
  await learner.getByLabel("Full name").fill("Timur Test");
  await learner.getByLabel("Email").fill(email);
  await learner.getByLabel("Password", { exact: true }).fill("Secret123");
  await learner.getByLabel("Confirm password").fill("Secret123");
  await learner.getByRole("button", { name: "Create account" }).click();
  await learner.getByText(/You need to accept the Terms of Use/).waitFor();
  await learner.getByLabel(/I agree to the/).check();
  await learner.getByRole("button", { name: "Create account" }).click();
  await learner.waitForURL(/\/onboarding/);
});

await step(learner, "onboarding", async () => {
  await learner.getByLabel("Education").selectOption({ index: 2 });
  await learner.getByRole("button", { name: "Continue" }).click();
  await learner.getByLabel("Side project or small sales").check();
  await learner.getByRole("button", { name: "Continue" }).click();
  await learner.getByRole("checkbox").first().check();
  await learner.getByRole("button", { name: "Continue to assessment" }).click();
  await learner.waitForURL("**/assessment");
});

await step(learner, "full assessment to results", async () => {
  await learner.getByRole("button", { name: "Start Assessment" }).click();
  await learner.waitForURL(/\/assessment\/\d+/);
  for (let i = 1; i <= 30; i++) {
    await learner.getByText(`Question ${i} of 30`).waitFor();
    const radios = learner.getByRole("radio");
    if (await radios.count()) await radios.nth(i % 3 === 0 ? 1 : 2).click();
    else await learner.getByLabel("Your answer").fill(ANSWER);
    await learner.waitForTimeout(120);
    await learner.getByRole("button", { name: i === 30 ? "Finish" : "Continue" }).click();
  }
  await learner.getByRole("button", { name: "See my results" }).click();
  await learner.waitForURL(/\/results\?attempt=/, { timeout: 30000 });
  await learner.getByText("Assessment Complete").waitFor();
  await learner.screenshot({ path: `${OUT}/results.png`, fullPage: true });
});

await step(learner, "dashboard shows the journey stepper", async () => {
  await learner.goto(B + "/dashboard");
  await learner.getByRole("list", { name: "Your development journey" }).waitFor();
  await axe(learner, "/dashboard");
  await learner.screenshot({ path: `${OUT}/dashboard.png`, fullPage: true });
});

await step(learner, "development plan → learn → practice", async () => {
  await learner.goto(B + "/development-plan");
  await learner.getByText("Priority 1").waitFor();
  await learner.getByRole("link", { name: /Start learning/i }).first().click();
  await learner.waitForURL(/\/learning\/\d+|\/plans/);
  if (learner.url().includes("/learning/")) {
    await learner.getByRole("button", { name: /^Start/ }).click();
    await learner.getByRole("button", { name: "Mark as complete" }).click();
    await learner.getByText(/Completed/).first().waitFor();
  }
  await learner.goto(B + "/development-plan");
  await learner.getByRole("link", { name: /Start practice/i }).first().click();
  await learner.waitForURL(/\/practice\/\d+/);
  await learner.getByRole("button", { name: "Start task" }).click();
  await learner.getByLabel("Your response").fill(ANSWER);
  await learner.getByRole("button", { name: "Submit for feedback" }).click();
  await learner.getByText("AI feedback").waitFor();
});

for (const path of ["/competencies", "/development-plan", "/learning", "/practice", "/progress", "/profile"]) {
  await step(learner, `learner page ${path}`, async () => {
    await learner.goto(B + path);
    await learner.getByRole("heading", { level: 1 }).first().waitFor();
    await axe(learner, path);
  });
}

await step(learner, "free plan: advanced resources are locked, plans page explains upgrades", async () => {
  await learner.goto(B + "/learning?difficulty=advanced");
  await learner.getByRole("link", { name: /requires a plan with advanced resources/ }).first().waitFor();
  await learner.goto(B + "/plans");
  await learner.getByText("Your plan: Free").waitFor();
  await learner.getByText("Online payment isn't available yet.", { exact: false }).waitFor();
  await axe(learner, "/plans");
});

await step(learner, "settings: sessions, plan usage, dev-mode email honesty", async () => {
  await learner.goto(B + "/settings");
  await learner.getByText("This device").waitFor();
  await learner.getByText(/of 2 used/).waitFor();
  await axe(learner, "/settings");
});

await step(learner, "learner is kept out of the admin area (UI and API)", async () => {
  await learner.goto(B + "/admin/users");
  await learner.waitForURL("**/dashboard");
  const status = await learner.evaluate(async () => (await fetch("/api/admin/users")).status);
  if (status !== 403) throw new Error(`expected 403 from /api/admin/users, got ${status}`);
  const csrf = await learner.evaluate(async () => (await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status);
  if (csrf !== 403) throw new Error(`expected 403 CSRF_FAILED without the header, got ${csrf}`);
});

// --- Admin -------------------------------------------------------------------------------------------
const admin = await newPage();
await useEnglish(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
let userUrl = "";
await step(admin, "super admin signs in and lands in the admin area", async () => {
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.waitForURL(/\/admin$/);
  await admin.getByRole("heading", { name: "Dashboard" }).waitFor();
  await axe(admin, "/admin");
  await admin.screenshot({ path: `${OUT}/admin-dashboard.png`, fullPage: true });
});

await step(admin, "find the new user with search", async () => {
  await admin.goto(B + "/admin/users");
  await admin.getByLabel("Search").fill(email);
  await admin.getByText("1–1 of 1").waitFor(); // debounced search has applied
  await admin.getByRole("link", { name: /Timur Test/ }).click();
  await admin.waitForURL(/\/admin\/users\/\d+/);
  userUrl = admin.url();
  await admin.getByRole("heading", { name: /Timur Test/ }).waitFor();
  await axe(admin, "/admin/users/:id");
});

await step(admin, "grant a time-limited Pro plan with a reason", async () => {
  await admin.getByRole("tab", { name: "Subscription" }).click();
  await admin.getByRole("button", { name: "Grant a plan" }).click();
  const d = admin.getByRole("dialog");
  await d.getByLabel("Plan").selectOption("pro");
  await d.getByLabel(/Duration in days/).fill("30");
  await d.getByLabel(/Reason/).fill("Incubator cohort scholarship");
  await d.getByRole("button", { name: "Grant plan" }).click();
  await admin.getByText("Plan updated").waitFor();
  await admin.getByRole("heading", { name: "Plan: Pro" }).waitFor();
});

await step(admin, "suspend requires a reason and signs the user out", async () => {
  await admin.getByRole("button", { name: "Suspend" }).click();
  const d = admin.getByRole("dialog");
  if (await d.getByRole("button", { name: "Suspend account" }).isEnabled()) throw new Error("confirm enabled without reason");
  await d.getByLabel(/Reason/).fill("E2E check");
  await d.getByRole("button", { name: "Suspend account" }).click();
  await admin.getByText("Account suspended", { exact: true }).first().waitFor();
  const me = await learner.evaluate(async () => (await fetch("/api/auth/me")).status);
  if (me !== 401) throw new Error(`suspended user's session still valid (${me})`);
});

await step(admin, "audit log records the actions", async () => {
  await admin.goto(B + "/admin/audit-logs?action=admin.");
  await admin.getByText("admin.user_suspended").first().waitFor();
  await admin.getByText("admin.subscription_assigned").first().waitFor();
  await axe(admin, "/admin/audit-logs");
});

await step(admin, "reactivate", async () => {
  await admin.goto(userUrl);
  await admin.getByRole("button", { name: "Reactivate" }).click();
  const d = admin.getByRole("dialog");
  await d.getByLabel(/Reason/).fill("Check finished");
  await d.getByRole("button", { name: "Reactivate" }).click();
  await admin.getByText("Account reactivated").first().waitFor();
});

await step(learner, "reactivated user signs in and has Pro entitlements", async () => {
  await login(learner, email, "Secret123");
  await learner.waitForURL("**/dashboard");
  await learner.goto(B + "/plans");
  await learner.getByText("Your plan: Pro").waitFor();
});

for (const path of ["/admin/plans", "/admin/roles", "/admin/subscriptions", "/admin/analytics", "/admin/settings", "/admin/assessments", "/admin/learning-resources"]) {
  await step(admin, `admin page ${path}`, async () => {
    await admin.goto(B + path);
    await admin.getByRole("heading", { level: 1 }).waitFor();
    await axe(admin, path);
  });
}

// --- Keyboard only -----------------------------------------------------------------------------------
const kb = await newPage();
await step(kb, "keyboard: sign in with Tab/Enter only", async () => {
  await kb.goto(B + "/login");
  await kb.getByRole("heading", { name: "Welcome back!" }).waitFor();
  const active = () => kb.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("type") ?? ""}:${document.activeElement?.textContent?.trim().slice(0, 30) ?? ""}`);
  for (let i = 0; i < 5 && !(await active()).startsWith("INPUT:email"); i++) await kb.keyboard.press("Tab");
  if (!(await active()).startsWith("INPUT:email")) throw new Error(`email field not reachable by Tab (${await active()})`);
  await kb.keyboard.type(ADMIN_EMAIL);
  await kb.keyboard.press("Tab");
  if (!(await active()).startsWith("INPUT:password")) throw new Error("password field is not next in tab order");
  await kb.keyboard.type(ADMIN_PASSWORD);
  await kb.keyboard.press("Enter");
  await kb.waitForURL(/\/admin$/);
});
await step(kb, "keyboard: skip link, sortable header and dialog focus handling", async () => {
  await kb.goto(B + "/admin/users");
  await kb.getByRole("heading", { name: "Users" }).waitFor();
  // On navigation the shell moves focus to <main>, so Tab continues inside the page content;
  // the skip link is the first focusable element of the document for people arriving fresh.
  const focusInfo = await kb.evaluate(() => ({ main: document.activeElement?.id, first: document.querySelector("a[href], button, input, select, textarea")?.textContent }));
  if (focusInfo.main !== "admin-main") throw new Error(`focus should be on main after navigation, got ${focusInfo.main}`);
  if (focusInfo.first !== "Skip to content") throw new Error(`first focusable element should be the skip link, got ${focusInfo.first}`);
  await kb.keyboard.press("Tab");
  const next = await kb.evaluate(() => document.activeElement?.textContent);
  if (next !== "Admin") throw new Error(`Tab from main should reach the breadcrumb, got ${next}`);
  const sort = kb.getByRole("columnheader", { name: /Registered/ }).getByRole("button");
  await sort.focus();
  await kb.keyboard.press("Enter");
  await kb.waitForURL(/sort=created_at&order=asc/);
  await kb.getByRole("link", { name: /Timur Test/ }).first().focus();
  await kb.keyboard.press("Enter");
  await kb.waitForURL(/\/admin\/users\/\d+/);
  const suspend = kb.getByRole("button", { name: "Suspend" });
  await suspend.focus();
  await kb.keyboard.press("Enter");
  const dialog = kb.getByRole("dialog");
  await dialog.waitFor();
  const inside = await kb.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
  if (!inside) throw new Error("focus did not move into the dialog");
  for (let i = 0; i < 8; i++) await kb.keyboard.press("Tab");
  if (!(await kb.evaluate(() => !!document.activeElement?.closest("[role=dialog]")))) throw new Error("focus escaped the dialog");
  await kb.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  const back = await kb.evaluate(() => document.activeElement?.textContent?.trim());
  if (back !== "Suspend") throw new Error(`focus should return to the Suspend button, got ${back}`);
});

// --- Mobile ------------------------------------------------------------------------------------------
const mobile = await newPage({ width: 390, height: 844 });
await step(mobile, "admin users on a phone: no horizontal page scroll", async () => {
  await login(mobile, ADMIN_EMAIL, ADMIN_PASSWORD);
  await mobile.waitForURL(/\/admin$/);
  await mobile.goto(B + "/admin/users");
  await mobile.getByRole("heading", { name: "Users" }).waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await mobile.screenshot({ path: `${OUT}/admin-users-mobile.png`, fullPage: true });
  if (overflow > 1) throw new Error(`page scrolls horizontally by ${overflow}px`);
  await mobile.getByRole("button", { name: "Open admin menu" }).click();
  await mobile.getByRole("dialog", { name: "Administration" }).waitFor();
});

for (const p of [learner, admin, kb, mobile]) if (p.errors.length) { failed = true; console.log("PAGE ERRORS", p.errors); }
await browser.close();
console.log(JSON.stringify({ steps: results.steps.filter((s) => !s.ok), axe: results.axe.filter((a) => a.violations.length) }, null, 2));
console.log(failed ? "E2E: FAILED" : "E2E: PASSED");
process.exit(failed ? 1 : 0);
