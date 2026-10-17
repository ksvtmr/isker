import { Toast, type ToastVariant } from "@isker/design-system";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface ToastMsg { id: number; variant?: ToastVariant; title: string; description?: string }
type Push = (t: Omit<ToastMsg, "id">) => void;

const ToastCtx = createContext<Push>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const push = useCallback<Push>((t) => setToast({ ...t, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.variant === "error" ? 6000 : 3200);
    return () => clearTimeout(id);
  }, [toast]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* The live region stays in the accessibility tree at all times (never display:none), so screen readers
          reliably announce a toast inserted into it; it is empty and takes no space while nothing is shown. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="ik-toast" data-empty={toast ? undefined : "true"}>
        {toast && <Toast key={toast.id} variant={toast.variant} title={toast.title} description={toast.description} onClose={() => setToast(null)} />}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
