import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// Existing tests assert English copy; localization tests switch languages explicitly.
beforeEach(async () => {
  window.localStorage.clear();
  await i18n.changeLanguage("en");
});
