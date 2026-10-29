/** Messages between the page (bridge.ts) and the in-browser API worker (worker.ts). */
export interface BridgeRequest {
  id: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export type BootStage = "runtime" | "packages" | "otherTab" | "database";

export type WorkerMessage =
  | { type: "progress"; stage: BootStage }
  | { type: "ready"; firstRun: boolean }
  | { type: "failed"; message: string }
  | { type: "response"; id: number; status: number; headers: Record<string, string>; body: string; error?: string };
