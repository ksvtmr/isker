// Smoke test of the in-browser API as built by build.py, run with Node (no browser needed):
//
//   node backend/browser/smoke.mjs frontend/dist/pyodide
//
// Loads exactly the files the GitHub Pages site serves, starts the API on a fresh SQLite database (seed included),
// and checks sign-in, learner and admin screens' data, a ru/kk translation and a registration. Exit code 1 on failure.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2] ?? "frontend/dist/pyodide");
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
let failures = 0;
const check = (cond, name, detail = "") => {
  console.log(`${cond ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

try {
  const { loadPyodide } = await import(pathToFileURL(`${dir}/pyodide.mjs`).href);
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
  const py = await loadPyodide({ indexURL: `${dir}/` });
  await py.loadPackage(manifest.packages, { messageCallback: () => {} });
  py.FS.mkdirTree("/wheels");
  for (const w of manifest.wheels) py.FS.writeFile(`/wheels/${w}`, new Uint8Array(readFileSync(`${dir}/wheels/${w}`)));
  await py.pyimport("micropip").install(manifest.wheels.map((w) => `emfs:/wheels/${w}`), { deps: false });
  py.unpackArchive(new Uint8Array(readFileSync(`${dir}/${manifest.backend}`)), "zip", { extractDir: "/isker" });
  py.runPython('import sys; sys.path.insert(0, "/isker")');
  const api = py.pyimport("isker_browser");
  const info = api.setup("/data").toJs({ dict_converter: Object.fromEntries });
  log(`API started (first run: ${info.first_run})`);

  const call = async (method, url, { token, lang = "en", body } = {}) => {
    const headers = { "accept-language": lang };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers["content-type"] = "application/json";
    const r = JSON.parse(await api.handle(method, url, JSON.stringify(headers), body ? JSON.stringify(body) : ""));
    let json = null;
    try { json = JSON.parse(r.body); } catch { /* not JSON */ }
    return { status: r.status, json };
  };
  const signIn = async (email, password) => (await call("POST", "/api/auth/login", { body: { email, password, remember_me: false } })).json?.access_token;

  let r = await call("GET", "/api/health");
  check(r.status === 200 && r.json?.database === true, "health and database");
  const demo = await signIn("demo@isker.local", "IskerDemo2026");
  check(Boolean(demo), "demo sign-in");
  r = await call("GET", "/api/auth/me", { token: demo });
  check(r.status === 200 && r.json?.email === "demo@isker.local", "current user");
  r = await call("GET", "/api/dashboard", { token: demo });
  check(r.status === 200 && r.json?.profile?.has_profile === true, "dashboard with the demo profile");
  r = await call("GET", "/api/competencies", { token: demo, lang: "kk" });
  check(r.status === 200 && JSON.stringify(r.json).includes("Мүмкіндіктерді анықтау"), "competencies in Kazakh");
  r = await call("GET", "/api/progress", { token: demo, lang: "ru" });
  check(r.status === 200 && Array.isArray(r.json?.snapshots) && r.json.snapshots.length > 0, "progress history");
  r = await call("GET", "/api/auth/me");
  check(r.status === 401, "anonymous request refused", String(r.status));
  r = await call("POST", "/api/auth/register", { body: { email: "smoke@example.com", password: "SmokeTest2026!", full_name: "Smoke Test", accept_terms: true } });
  check(r.status === 201 && Boolean(r.json?.access_token), "registration", String(r.status));
  const admin = await signIn("admin@isker.local", "IskerAdmin2026");
  r = await call("GET", "/api/admin/users", { token: admin });
  const total = r.json?.total ?? r.json?.items?.length;
  check(r.status === 200 && total >= 3, "admin user list", `${total} users`);
  r = await call("POST", "/api/auth/logout", { token: demo });
  r = await call("GET", "/api/auth/me", { token: demo });
  check(r.status === 401, "sign-out revokes the session");
} catch (e) {
  console.log(`✖ ${e?.message ?? e}`);
  failures++;
}
log(failures ? `IN-BROWSER API: FAILED (${failures})` : "IN-BROWSER API: PASSED");
process.exit(failures ? 1 : 0);
