import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LearningPage } from "../pages/Learning";
import { mockApi, renderWithProviders } from "./utils";

describe("learning filters live in the URL", () => {
  it("applies filters from the address (refresh, shared links)", async () => {
    const calls = mockApi({
      "GET /api/competencies": { areas: [], competencies: [] },
      "GET /api/learning/resources": { items: [], total: 0, page: 2, page_size: 12 },
    });
    renderWithProviders(<LearningPage />, { route: "/learning?difficulty=advanced&type=video&page=2", path: "/learning" });
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/learning/resources"))).toBe(true));
    const req = calls.find((c) => c.url.includes("/api/learning/resources"))!.url;
    expect(req).toContain("difficulty=advanced");
    expect(req).toContain("type=video");
    expect(req).toContain("page=2");
  });
});
