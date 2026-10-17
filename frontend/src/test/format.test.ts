import { describe, expect, it } from "vitest";
import { __formatKazakhDate } from "../i18n/format";

describe("Kazakh date fallback (engines without kk locale data)", () => {
  const d = new Date(2026, 9, 17, 8, 6);
  it("uses Kazakh month names in CLDR order", () => {
    expect(__formatKazakhDate(d, { day: "numeric", month: "long", year: "numeric" })).toBe("2026 ж. 17 қазан");
    expect(__formatKazakhDate(d, { day: "numeric", month: "short", year: "numeric" })).toBe("2026 ж. 17 қаз.");
  });
  it("adds 24-hour time", () => {
    expect(__formatKazakhDate(d, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })).toBe("2026 ж. 17 қаз., 08:06");
  });
  it("never produces Latin month names", () => {
    for (let m = 0; m < 12; m++) expect(__formatKazakhDate(new Date(2026, m, 1), { day: "numeric", month: "short" })).not.toMatch(/[A-Za-z]/);
  });
});
