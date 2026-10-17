/**
 * Cross-site build (GitHub Pages interface + API on Render): the session token goes in an Authorization header,
 * cookies are not sent, and a revoked token is forgotten. Same-site builds keep cookie + CSRF behaviour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

function mockFetch(status = 200, body: unknown = {}) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function loadClient(apiBase: string) {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", apiBase);
  return import("../api/client");
}

afterEach(() => {
  vi.unstubAllEnvs();
  sessionStorage.clear();
  localStorage.clear();
});

describe("cross-site API client", () => {
  it("sends the stored token as Bearer to the API origin without cookies", async () => {
    const client = await loadClient("https://isker.example.com/");
    const fetch = mockFetch();
    client.setSessionToken("tok-1");
    await client.api.post("/api/sync/state");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://isker.example.com/api/sync/state");
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
  });

  it("keeps the token for the tab, or across visits with Remember me", async () => {
    const client = await loadClient("https://isker.example.com");
    client.setSessionToken("tab-only");
    expect(sessionStorage.getItem("isker_session")).toBe("tab-only");
    expect(localStorage.getItem("isker_session")).toBeNull();
    client.setSessionToken("remembered", true);
    expect(localStorage.getItem("isker_session")).toBe("remembered");
    expect(sessionStorage.getItem("isker_session")).toBeNull();
    client.setSessionToken(null);
    expect(client.sessionToken()).toBeNull();
  });

  it("forgets a revoked token", async () => {
    const client = await loadClient("https://isker.example.com");
    mockFetch(401, { error: { code: "SESSION_REVOKED", message: "ended" } });
    client.setSessionToken("old");
    await expect(client.api.get("/api/progress")).rejects.toMatchObject({ status: 401 });
    expect(client.sessionToken()).toBeNull();
  });
});

describe("same-site API client", () => {
  it("uses the session cookie and never stores a token", async () => {
    const client = await loadClient("");
    const fetch = mockFetch();
    client.setSessionToken("ignored");
    expect(client.sessionToken()).toBeNull();
    await client.api.get("/api/auth/me");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/me");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
