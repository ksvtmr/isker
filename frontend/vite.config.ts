/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: 5173,
    host: true,
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
});
