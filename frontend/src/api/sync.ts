/**
 * Live refresh for open tabs. `GET /api/sync/state` returns cheap opaque versions; this hook polls it every 30 s
 * and when the tab regains focus, and refetches only what changed. Access control never depends on it: the API
 * checks status, roles and plan on every request, and a blocked account gets 401 ACCOUNT_SUSPENDED/DEACTIVATED
 * from this very poll, which signs the tab out (see setUnauthorizedHandler in App.tsx).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "./client";
import { derivedKeys, keys } from "./keys";

export interface SyncState {
  user_version: number;
  access_version: string;
  entitlements_version: string;
  content_version: string | null;
  server_time: string;
}

export const SYNC_INTERVAL_MS = 30_000;

export function useLiveSync(enabled: boolean) {
  const qc = useQueryClient();
  const prev = useRef<SyncState | null>(null);
  const { data } = useQuery({
    queryKey: ["sync-state"],
    queryFn: () => api.get<SyncState>("/api/sync/state"),
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: enabled ? SYNC_INTERVAL_MS : false,
  });
  useEffect(() => {
    if (!data) return;
    const p = prev.current;
    prev.current = data;
    if (!p) return;
    const userChanged = p.user_version !== data.user_version || p.access_version !== data.access_version;
    const plansChanged = p.entitlements_version !== data.entitlements_version;
    const contentChanged = p.content_version !== data.content_version;
    if (userChanged) {
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.profile });
    }
    if (plansChanged) {
      for (const k of [["subscription"], ["entitlements"], ["plans"], ...derivedKeys]) void qc.invalidateQueries({ queryKey: k });
    }
    if (contentChanged) {
      // Content may appear in any learner or admin view: refetch everything except the session and this poll.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "sync-state" });
    } else if (userChanged || plansChanged) {
      void qc.invalidateQueries({ queryKey: ["admin"] });
    }
  }, [data, qc]);
}
