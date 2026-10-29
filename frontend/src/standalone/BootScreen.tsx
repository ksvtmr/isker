import { Button } from "@isker/design-system";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { bootStandalone, onBootProgress } from "./bridge";
import type { BootStage } from "./protocol";

/**
 * Standalone build: shown until the in-browser API is running (first visit downloads the Python runtime and creates
 * the demo data). Renders the app afterwards.
 */
export function BootScreen({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  const [stage, setStage] = useState<BootStage>("runtime");
  const [state, setState] = useState<"booting" | "ready" | "failed">("booting");
  const [error, setError] = useState("");

  useEffect(() => {
    const off = onBootProgress(setStage);
    bootStandalone().then(() => setState("ready"), (e: Error) => { setError(e.message); setState("failed"); });
    return off;
  }, []);

  if (state === "ready") return <>{children}</>;
  return (
    <main style={{ maxWidth: 480, margin: "18vh auto 0", padding: 16, textAlign: "center", display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>{t("standalone.title")}</h1>
      {state === "booting" ? (
        <>
          <span className="isk-spinner" aria-hidden="true" style={{ width: 28, height: 28, borderWidth: 3, borderColor: "var(--color-brand-200)", borderTopColor: "var(--color-brand-600)" }} />
          <p role="status" aria-live="polite" style={{ margin: 0 }}>{t(`standalone.${stage}`)}</p>
          {stage === "database" && <p className="isk-hint" style={{ margin: 0 }}>{t("standalone.firstRun")}</p>}
        </>
      ) : (
        <>
          <p role="alert" style={{ margin: 0 }}>{t("standalone.failed")}</p>
          <p className="isk-hint" style={{ margin: 0, wordBreak: "break-word" }}>{error}</p>
          <Button onClick={() => window.location.reload()}>{t("standalone.retry")}</Button>
        </>
      )}
      <p className="isk-hint" style={{ margin: 0 }}>{t("standalone.note")}</p>
    </main>
  );
}
