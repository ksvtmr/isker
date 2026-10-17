/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const apiTarget = process.env.VITE_API_PROXY ?? "http://localhost:8000";

/**
 * Cross-site build (VITE_API_BASE_URL set, e.g. GitHub Pages + Render): the static host can't send security headers,
 * so the same Content-Security-Policy the API sends (backend/app/core/middleware.py) goes into a <meta> tag, with the
 * API's origin allowed for fetch. Same-site builds get the header from the API instead.
 */
function crossSiteCsp(apiBase: string): Plugin {
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data:", "font-src 'self' data:", `connect-src 'self' ${new URL(apiBase).origin}`,
    "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join("; ");
  return {
      name: "isker-cross-site-csp",
      transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "VITE_");
  const apiBase = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL ?? "";
  return {
  // Path the app is served under: "/" normally, "/isker/" on GitHub Pages (set by .github/workflows/pages.yml).
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), ...(apiBase ? [crossSiteCsp(apiBase)] : [])],
  // One .env for the whole project: VITE_* values are read from the repository root (see .env.example).
  envDir: "..",
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: 5173,
    host: true,
    // In Docker on Windows/macOS file events from bind mounts are unreliable; poll instead.
    watch: process.env.VITE_USE_POLLING === "true" ? { usePolling: true, interval: 300 } : undefined,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  preview: { port: 4173, proxy: { "/api": { target: apiTarget, changeOrigin: true } } },
  build: { sourcemap: true, chunkSizeWarningLimit: 800 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
  };
});
