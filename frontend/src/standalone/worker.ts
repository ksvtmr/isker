/// <reference lib="webworker" />
/**
 * Standalone (GitHub Pages) build: runs the real Isker API (backend/app, Python) in this Web Worker with Pyodide.
 * Files come from `<base>/pyodide/` (built by backend/browser/build.py). The SQLite database lives in IndexedDB, so
 * each browser keeps its own private copy of the platform across visits.
 */
import type { BridgeRequest, WorkerMessage } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

interface Manifest { packages: string[]; wheels: string[]; backend: string }
interface PyFS {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  mount(type: unknown, opts: object, path: string): void;
  syncfs(populate: boolean, cb: (err: unknown) => void): void;
  filesystems: { IDBFS: unknown };
}
interface Py {
  FS: PyFS;
  loadPackage(names: string[], opts?: object): Promise<unknown>;
  pyimport(name: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  runPython(code: string): unknown;
  unpackArchive(data: Uint8Array, format: string, opts?: object): void;
}

const ROOT = new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.origin).href;
const post = (m: WorkerMessage) => self.postMessage(m);

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * One tab at a time: each tab holds its own copy of the database in memory and saves it whole, so two tabs would
 * overwrite each other's changes. The tab that opens Isker first keeps a Web Lock until it closes; another tab
 * waits (and says so) instead.
 */
async function lockDatabase(): Promise<void> {
  const locks = (self.navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return;
  const name = "isker-standalone-database";
  const hold = () => new Promise<never>(() => {});
  const free = await new Promise<boolean>((resolve) => {
    void locks.request(name, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock ? hold() : undefined;
    });
  });
  if (free) return;
  post({ type: "progress", stage: "otherTab" });
  await new Promise<void>((resolve) => { void locks.request(name, () => { resolve(); return hold(); }); });
}

function sync(fs: PyFS, populate: boolean): Promise<void> {
  return new Promise((resolve, reject) => fs.syncfs(populate, (err) => (err ? reject(err) : resolve())));
}

async function boot() {
  post({ type: "progress", stage: "runtime" });
  const manifest = (await (await fetch(ROOT + "manifest.json")).json()) as Manifest;
  const { loadPyodide } = (await import(/* @vite-ignore */ ROOT + "pyodide.mjs")) as { loadPyodide: (o: object) => Promise<Py> };
  const py = await loadPyodide({ indexURL: ROOT });
  post({ type: "progress", stage: "packages" });
  await py.loadPackage(manifest.packages, { messageCallback: () => {} });
  py.FS.mkdirTree("/wheels");
  for (const w of manifest.wheels) py.FS.writeFile(`/wheels/${w}`, await bytes(`${ROOT}wheels/${w}`));
  await py.pyimport("micropip").install(manifest.wheels.map((w) => `emfs:/wheels/${w}`), { deps: false });
  py.unpackArchive(await bytes(ROOT + manifest.backend), "zip", { extractDir: "/isker" });

  await lockDatabase();
  post({ type: "progress", stage: "database" });
  py.FS.mkdirTree("/data");
  py.FS.mount(py.FS.filesystems.IDBFS, {}, "/data");
  await sync(py.FS, true);
  py.runPython(`import os, sys; sys.path.insert(0, "/isker"); os.environ["APP_BASE_URL"] = ${JSON.stringify(self.location.origin + import.meta.env.BASE_URL.replace(/\/$/, ""))}`);
  const api = py.pyimport("isker_browser");
  const info = api.setup("/data").toJs({ dict_converter: Object.fromEntries }) as { first_run: boolean };
  await sync(py.FS, false);
  post({ type: "ready", firstRun: info.first_run });
  return { api, fs: py.FS };
}

const booted = boot().catch((e: unknown) => {
  post({ type: "failed", message: e instanceof Error ? e.message : String(e) });
  throw e;
});

// One request at a time (SQLite, no threads). A change is saved to IndexedDB before its response is delivered, so
// nothing the interface reported as saved is lost on reload; reads (which may update "last seen") save shortly after.
let queue: Promise<unknown> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

self.onmessage = (ev: MessageEvent<BridgeRequest>) => {
  const req = ev.data;
  queue = queue.then(async () => {
    try {
      const { api, fs } = await booted;
      const reply = JSON.parse(await api.handle(req.method, req.url, JSON.stringify(req.headers), req.body ?? "")) as
        { status: number; headers: Record<string, string>; body: string };
      clearTimeout(saveTimer);
      if (req.method === "GET") saveTimer = setTimeout(() => void sync(fs, false).catch(() => {}), 300);
      else await sync(fs, false);
      post({ type: "response", id: req.id, ...reply });
    } catch (e) {
      console.error("Isker API (in browser):", e);
      post({ type: "response", id: req.id, status: 0, headers: {}, body: "", error: e instanceof Error ? e.message : String(e) });
    }
  });
};
