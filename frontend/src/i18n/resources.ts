/** Bundles every locales/<lang>/<namespace>.json file at build time. */
import type { Resource } from "i18next";

const files = import.meta.glob<Record<string, unknown>>("./locales/*/*.json", { eager: true, import: "default" });

export const resources: Resource = {};
for (const [path, data] of Object.entries(files)) {
  const m = /\.\/locales\/(\w+)\/(\w+)\.json$/.exec(path);
  if (!m) continue;
  const [, lng, ns] = m;
  (resources[lng] ??= {})[ns] = data as Record<string, string>;
}
