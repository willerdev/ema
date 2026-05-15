import { useEffect } from 'react';

export function usePolling(callback: () => void | Promise<void>, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    void callback();
    const timer = setInterval(() => {
      void callback();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, callback]);
}
