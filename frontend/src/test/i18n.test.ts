/**
 * Translation integrity, enforced in CI:
 *  - every namespace exists in ru, kk and en with exactly the same keys;
 *  - no empty strings; interpolation variables match across languages;
 *  - every literal key used in the source (t("ns:key") or t("key") with useTranslation("ns")) exists.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { LANGUAGES, NAMESPACES } from "../i18n/config";
import { resources } from "../i18n/resources";

type Tree = { [k: string]: string | Tree };
const flatten = (t: Tree, p = ""): Record<string, string> =>
  Object.entries(t).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === "string") acc[key] = v;
    else Object.assign(acc, flatten(v, key));
    return acc;
  }, {});
const vars = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort().join(",");
const ns = (lng: string, n: string) => flatten((resources[lng]?.[n] ?? {}) as Tree);
const PLURAL = /_(zero|one|two|few|many|other)$/;

describe("translation files", () => {
  for (const n of NAMESPACES) {
    it(`${n}: same keys, no empty values, same interpolation variables in ru/kk/en`, () => {
      const en = ns("en", n);
      expect(Object.keys(en).length).toBeGreaterThan(0);
      for (const lng of LANGUAGES) {
        const cur = ns(lng, n);
        expect(Object.keys(cur).sort(), `${lng}/${n}.json keys`).toEqual(Object.keys(en).sort());
        for (const [k, v] of Object.entries(cur)) {
          expect(v.trim(), `${lng}/${n}:${k} is empty`).not.toBe("");
          if (!PLURAL.test(k)) expect(vars(v), `${lng}/${n}:${k} variables`).toBe(vars(en[k]));
        }
      }
    });
  }
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "test" || f === "i18n" ? [] : sourceFiles(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("keys used in the source", () => {
  it("all exist in English (and therefore in every language)", () => {
    const root = join(__dirname, "..");
    const missing: string[] = [];
    const exists = (n: string, key: string) => {
      const flat = ns("en", n);
      return key in flat || `${key}_one` in flat || `${key}_other` in flat || Object.keys(flat).some((k) => k.startsWith(`${key}.`));
    };
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, "utf8");
      const m = /useTranslation\(\s*(?:\[\s*)?"(\w+)"/.exec(src);
      const defaultNs = m ? m[1] : "common";
      for (const call of src.matchAll(/\bt\(\s*"([\w.:-]+)"/g)) {
        const raw = call[1];
        const [n, key] = raw.includes(":") ? raw.split(":") : [defaultNs, raw];
        if (!(NAMESPACES as readonly string[]).includes(n) || !exists(n, key)) missing.push(`${relative(root, file)}: ${raw}`);
      }
      for (const call of src.matchAll(/"((?:common|errors|auth|public|subscriptions|dashboard|assessment|learning|account|admin|adminContent):[\w.-]+)"/g)) {
        const [n, key] = call[1].split(":");
        if (!exists(n, key)) missing.push(`${relative(root, file)}: ${call[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("runtime", () => {
  it("initializes all three languages with interpolation and plural rules", async () => {
    await i18n.changeLanguage("ru");
    expect(i18n.t("common:time.days", { count: 1 })).toBe("1 день");
    expect(i18n.t("common:time.days", { count: 3 })).toBe("3 дня");
    expect(i18n.t("common:time.days", { count: 5 })).toBe("5 дней");
    expect(i18n.t("common:ds.questionOf", { current: 2, total: 30 })).toBe("Вопрос 2 из 30");
    await i18n.changeLanguage("kk");
    expect(i18n.t("common:actions.save")).toBe("Сақтау");
    expect(i18n.t("common:time.days", { count: 5 })).toBe("5 күн");
    await i18n.changeLanguage("en");
    expect(i18n.t("common:time.days", { count: 1 })).toBe("1 day");
    expect(i18n.t("common:time.days", { count: 2 })).toBe("2 days");
    expect(document.documentElement.lang).toBe("en");
  });
});
