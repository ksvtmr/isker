import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ApiError, STANDALONE } from "./api/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toaster";
import { BASE_PATH } from "./utils/appHref";
import "./i18n";
import { I18nDSProvider } from "./i18n/DSBridge";
import { BootScreen } from "./standalone/BootScreen";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Retry transient failures only, never client errors.
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={BASE_PATH || "/"}>
        <I18nDSProvider>
          <ToastProvider>
            {STANDALONE ? <BootScreen><App /></BootScreen> : <App />}
          </ToastProvider>
        </I18nDSProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
