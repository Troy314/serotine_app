import { createContext, useCallback, useContext, useState } from "react";

const ToastContext = createContext(null);
const DEFAULT_DURATION_MS = 5000;

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message, opts = {}) => {
      const id = nextId++;
      const type = opts.type || "info"; // "info" | "success" | "error"
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => dismiss(id), opts.duration || DEFAULT_DURATION_MS);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

/** `useToast()` returns a plain `showToast(message, { type })` function —
 * replaces the scattered `alert()` calls that used to interrupt with a
 * blocking native dialog for what's genuinely just a status message
 * (import results, save errors). Confirmations for destructive actions
 * (delete/merge/restore) deliberately still use `window.confirm()` — a
 * toast can't gate on a decision, only report one after the fact, so
 * that's a different, still-legitimate use of the native dialog. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used within <ToastProvider>");
  return ctx.showToast;
}

export function useToastList() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastList() must be used within <ToastProvider>");
  return { toasts: ctx.toasts, dismiss: ctx.dismiss };
}
