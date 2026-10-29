/**
 * Page side of the standalone build: starts the API worker and offers a fetch() replacement, so api/client.ts works
 * unchanged. Requests stay in the browser.
 */
import type { BootStage, BridgeRequest, WorkerMessage } from "./protocol";

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const progressListeners = new Set<(stage: BootStage) => void>();
let readyResolve!: (firstRun: boolean) => void;
let readyReject!: (e: Error) => void;
/** Resolves (first visit: true) once the API is running in the worker; rejects if it could not start. */
export const standaloneReady = new Promise<boolean>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

export function onBootProgress(fn: (stage: BootStage) => void): () => void {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

function start(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
    const m = ev.data;
    if (m.type === "progress") progressListeners.forEach((fn) => fn(m.stage));
    else if (m.type === "ready") readyResolve(m.firstRun);
    else if (m.type === "failed") readyReject(new Error(m.message));
    else if (m.type === "response") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (!p) return;
      if (m.error) p.reject(new TypeError(m.error));
      else p.resolve(new Response(m.status === 204 || m.status === 304 ? null : m.body, { status: m.status, headers: m.headers }));
    }
  };
  worker.onerror = (e) => readyReject(new Error(e.message || "worker error"));
  return worker;
}

/** Starts the in-browser API (idempotent). */
export function bootStandalone(): Promise<boolean> {
  start();
  return standaloneReady;
}

/** fetch() for API paths, answered by the in-browser API. */
export function standaloneFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const w = start();
  const url = new URL(input, "https://isker.local");
  const req: BridgeRequest = {
    id: nextId++,
    method: (init.method ?? "GET").toUpperCase(),
    url: url.pathname + url.search,
    headers: { ...(init.headers as Record<string, string> | undefined) },
    body: typeof init.body === "string" ? init.body : undefined,
  };
  return new Promise((resolve, reject) => {
    pending.set(req.id, { resolve, reject });
    w.postMessage(req);
  });
}
