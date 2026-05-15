import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastVariant = 'success' | 'error';

type ToastState = {
  message: string;
  variant: ToastVariant;
} | null;

type ToastContextValue = {
  toast: ToastState;
  showToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DISMISS_MS = 2500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, variant: ToastVariant = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, variant });
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, DISMISS_MS);
  }, []);

  const value = useMemo(() => ({ toast, showToast }), [toast, showToast]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToastContext must be used within ToastProvider');
  return ctx;
}
