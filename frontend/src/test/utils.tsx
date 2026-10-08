import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { ToastProvider } from "../components/Toaster";

export function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

export function renderWithProviders(ui: ReactElement, { route = "/", path = "*" }: { route?: string; path?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type Handler = (body: unknown, url: string) => { status?: number; json: unknown };

/** Stubs fetch with a "METHOD /path" → handler table. Unmatched requests fail the test loudly. */
export function mockApi(routes: Record<string, Handler | unknown>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/\?.*$/, "");
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && new RegExp(`^${p.replace(/:\w+/g, "[^/]+")}$`).test(path);
    });
    if (!key) return new Response(JSON.stringify({ error: { code: "NOT_MOCKED", message: `${method} ${path}` } }), { status: 599 });
    const h = routes[key];
    const res = typeof h === "function" ? (h as Handler)(body, url)
      : h && typeof h === "object" && "json" in h ? (h as { status?: number; json: unknown }) : { json: h };
    return new Response(JSON.stringify(res.json), { status: res.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}
