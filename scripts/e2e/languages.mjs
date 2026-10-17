/**
 * Localization end-to-end check against a running Isker (API + built SPA on one origin).
 *
 *   BASE=http://localhost:8000 node languages.mjs [screenshot-dir]
 *
 * For each interface language (ru, kk, en) it signs in as the seeded demo learner and the seeded admin and visits
 * every main route, checking that:
 *   - <html lang> matches the language;
 *   - no raw translation key (any key from the locale files) is visible;
 *   - visible text is written in the expected script (Cyrillic for ru/kk, with Kazakh-specific letters for kk;
 *     Latin for en), so a silent fallback to another language is caught;
 *   - content stored in the database (competency names) is shown in that language;
 *   - nothing scrolls horizontally on a 390 px phone (long translations).
 * It also checks that switching language keeps the route and query string, survives a reload, and that the saved
 * account language is applied after signing in again.
 * Selectors do not depend on the interface language. Exit code is non-zero on any failure.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "../../frontend/src/i18n/locales");
const B = process.env.BASE ?? "http://localhost:8000";
const OUT = process.argv[2] ?? "e2e-lang-shots";
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@isker.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "IskerDemo2026";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@isker.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "IskerAdmin2026";
// CHROMIUM_PATH, else the pre-installed browser of the Claude Code environment, else Playwright's own (CI).
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(OUT, { recursive: true });

// Every translation key ("namespace:dotted.key" and "dotted.key") — none of them may appear as visible text.
const KEYS = new Set();
for (const ns of readdirSync(join(LOCALES, "en"))) {
  const walk = (o, prefix) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") walk(v, key);
      else if (key.includes(".")) KEYS.add(key.replace(/_(one|few|many|other)$/, ""));
    }
  };
  walk(JSON.parse(readFileSync(join(LOCALES, "en", ns), "utf8")), "");
}

const SPOTTING = { ru: "Выявление возможностей", kk: "Мүмкіндіктерді анықтау", en: "Spotting Opportunities" };
const LEARNER_ROUTES = ["/dashboard", "/assessment", "/results", "/competencies", "/development-plan", "/learning", "/practice",
  "/progress", "/profile", "/settings", "/plans"];
const ADMIN_ROUTES = ["/admin", "/admin/users", "/admin/roles", "/admin/subscriptions", "/admin/plans", "/admin/assessments",
  "/admin/competencies", "/admin/learning-resources", "/admin/analytics", "/admin/ai", "/admin/audit-logs", "/admin/settings",
  "/admin/translations"];
// Admin pages whose data is shown as stored: content editors and the translations page show the English base text
// being edited, the audit log and AI pages show machine codes / model ids next to translated labels. On these pages
// only the interface itself (headings, table headers, labels, buttons, tabs) is checked for the language.
const DATA_ROUTES = ["/admin/competencies", "/admin/learning-resources", "/admin/assessments", "/admin/translations",
  "/admin/audit-logs", "/admin/ai"];
const PUBLIC_ROUTES = ["/", "/login", "/register", "/forgot-password", "/terms", "/privacy", "/plans", "/no-such-page"];

const browser = await chromium.launch({ executablePath: CHROMIUM });
const failures = [];
let checks = 0;

function fail(lang, route, msg) {
  failures.push({ lang, route, msg });
  console.log("FAIL", lang, route, "-", msg);
}

async function context(lang, viewport = { width: 1440, height: 900 }) {
  // The browser language is deliberately different from the language under test, so detection can't hide bugs.
  const ctx = await browser.newContext({ viewport, locale: lang === "en" ? "ru-RU" : "en-US" });
  await ctx.addInitScript((l) => { try { localStorage.setItem("isker.lang", l); } catch { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  return { ctx, page };
}

async function signIn(page, email, password, lang) {
  await page.goto(B + "/login");
  const status = await page.evaluate(async ([e, p, l]) => {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": l },
      body: JSON.stringify({ email: e, password: p, remember_me: false }) });
    return r.status;
  }, [email, password, lang]);
  if (status !== 200) throw new Error(`login ${email} → ${status}`);
}

async function setAccountLanguage(page, lang) {
  await page.evaluate(async (l) => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("isker_csrf="))?.split("=")[1] ?? "";
    await fetch("/api/auth/me/language", { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ language: l }) });
  }, lang);
}

async function inspect(page, lang, route, { phone = false } = {}) {
  checks++;
  await page.goto(B + route);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(150);
  const chromeOnly = DATA_ROUTES.some((r) => route.startsWith(r));
  const info = await page.evaluate((onlyChrome) => {
    const main = document.querySelector("main") ?? document.body;
    // The language selector always lists "Русский / Қазақша / English": not part of the interface language.
    const clone = main.cloneNode(true);
    clone.querySelectorAll("select option").forEach((o) => o.remove());
    document.body.appendChild(clone);
    clone.style.position = "absolute"; clone.style.left = "-99999px";
    const text = onlyChrome
      ? [...clone.querySelectorAll("h1, h2, h3, th, label, button, legend, [role=tab], nav a")].map((e) => e.innerText).join("\n")
      : clone.innerText;
    clone.remove();
    return { lang: document.documentElement.lang, text, overflow: document.documentElement.scrollWidth - window.innerWidth, title: document.title };
  }, chromeOnly);
  if (info.lang !== lang) fail(lang, route, `<html lang="${info.lang}">`);
  const rawKeys = info.text.split(/\s+/).map((w) => w.replace(/^[^\w:]+|[^\w.]+$/g, "")).filter((w) => KEYS.has(w) || KEYS.has(w.split(":")[1] ?? ""));
  if (rawKeys.length) fail(lang, route, `raw translation keys visible: ${[...new Set(rawKeys)].slice(0, 5).join(", ")}`);
  // Script check on interface text: strip emails, URLs, numbers and product names.
  const letters = info.text.replace(/\S+@\S+|https?:\/\/\S+|Isker|EntreComp|Google|SCAMPER|Crazy 8s|Pro|Premium|Free|SMTP|OpenAI|JSON|[0-9]/g, "")
    .match(/\p{L}/gu) ?? [];
  const cyr = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  const share = letters.length ? cyr / letters.length : 1;
  if (lang !== "en" && share < 0.85) fail(lang, route, `only ${(share * 100).toFixed(0)}% Cyrillic letters`);
  if (lang === "en" && share > 0.1) fail(lang, route, `${(share * 100).toFixed(0)}% Cyrillic letters in English UI`);
  if (lang === "kk" && letters.length > 200 && !/[әғқңөұүһі]/i.test(info.text)) fail(lang, route, "no Kazakh-specific letters (Russian shown instead?)");
  if (phone && info.overflow > 1) fail(lang, route, `horizontal scroll ${info.overflow}px at 390px`);
  return info;
}

for (const lang of ["ru", "kk", "en"]) {
  console.log(`\n=== ${lang} ===`);
  const anon = await context(lang);
  for (const r of PUBLIC_ROUTES) await inspect(anon.page, lang, r);
  await anon.ctx.close();

  const learner = await context(lang);
  await signIn(learner.page, DEMO_EMAIL, DEMO_PASSWORD, lang);
  await setAccountLanguage(learner.page, lang);
  for (const r of LEARNER_ROUTES) {
    const info = await inspect(learner.page, lang, r);
    if (r === "/competencies" && !info.text.includes(SPOTTING[lang])) fail(lang, r, `competency name not in ${lang}`);
  }
  await learner.page.screenshot({ path: `${OUT}/${lang}-settings.png`, fullPage: true });
  if (learner.page.errors.length) fail(lang, "learner", `page errors: ${learner.page.errors.slice(0, 3).join(" | ")}`);
  await learner.ctx.close();

  const phone = await context(lang, { width: 390, height: 844 });
  await signIn(phone.page, DEMO_EMAIL, DEMO_PASSWORD, lang);
  for (const r of ["/dashboard", "/results", "/development-plan", "/settings", "/plans"]) await inspect(phone.page, lang, r, { phone: true });
  await phone.ctx.close();

  const admin = await context(lang);
  await signIn(admin.page, ADMIN_EMAIL, ADMIN_PASSWORD, lang);
  await setAccountLanguage(admin.page, lang);
  for (const r of ADMIN_ROUTES) await inspect(admin.page, lang, r);
  await admin.page.screenshot({ path: `${OUT}/${lang}-admin-users.png`, fullPage: true });
  if (admin.page.errors.length) fail(lang, "admin", `page errors: ${admin.page.errors.slice(0, 3).join(" | ")}`);
  await admin.ctx.close();
}

// Switching language keeps the route and query, persists across reload, and the account language wins after sign-in.
{
  const { ctx, page } = await context("en");
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD, "en");
  await setAccountLanguage(page, "en");
  const route = "/admin/users?status=active";
  await page.goto(B + route);
  await page.waitForLoadState("networkidle");
  checks++;
  const select = page.locator("select.isk-lang__select, select[id*=lang], select").filter({ has: page.locator('option[value="kk"]') }).first();
  await select.selectOption("kk");
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ url: location.pathname + location.search, lang: document.documentElement.lang }));
  if (after.url !== route) fail("switch", route, `route changed to ${after.url}`);
  if (after.lang !== "kk") fail("switch", route, `lang after switch is ${after.lang}`);
  await page.reload();
  await page.waitForLoadState("networkidle");
  if ((await page.evaluate(() => document.documentElement.lang)) !== "kk") fail("switch", route, "language lost on reload");
  await ctx.close();

  // A fresh browser (stored preference "ru") signs in: the account's saved language (kk) must win.
  const fresh = await context("ru");
  await signIn(fresh.page, ADMIN_EMAIL, ADMIN_PASSWORD, "ru");
  await fresh.page.goto(B + "/admin");
  await fresh.page.waitForLoadState("networkidle");
  await fresh.page.waitForTimeout(400);
  checks++;
  if ((await fresh.page.evaluate(() => document.documentElement.lang)) !== "kk") fail("persist", "/admin", "saved account language not applied after sign-in");
  await setAccountLanguage(fresh.page, "ru");
  await fresh.ctx.close();
}

await browser.close();
console.log(`\n${checks} page checks, ${failures.length} failures`);
console.log(failures.length ? "LANGUAGES E2E: FAILED" : "LANGUAGES E2E: PASSED");
process.exit(failures.length ? 1 : 0);
