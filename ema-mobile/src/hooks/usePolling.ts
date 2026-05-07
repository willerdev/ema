import { useEffect } from 'react';

export function usePolling(callback: () => void | Promise<void>, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    callback();
    const timer = setInterval(() => {
      callback();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, callback]);
}
