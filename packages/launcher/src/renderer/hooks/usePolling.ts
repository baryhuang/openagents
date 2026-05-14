import { useEffect, useRef } from 'react';

/**
 * Calls `fn` immediately and then every `intervalMs` while `enabled` is true.
 * Guarantees that a slow `fn` cannot pile up overlapping calls.
 */
export function usePolling(
  fn: () => Promise<unknown> | unknown,
  intervalMs: number,
  enabled: boolean = true,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try { await fnRef.current(); } catch { /* swallow — caller logs */ }
      if (cancelled) return;
      timer = setTimeout(tick, intervalMs);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}
