import { useCallback, useEffect } from 'react';

import { ipc } from '../lib/api';
import { LOGS_INITIAL_LINES, useLogsStore } from '../store/logsStore';

import { usePolling } from './usePolling';

interface UseLogsResult {
  refresh: () => Promise<void>;
  clearRange: (start: string, end: string) => Promise<void>;
  copy: () => Promise<void>;
}

const AUTO_REFRESH_MS = 3000;

export function useLogs(): UseLogsResult {
  const filter = useLogsStore((s) => s.filter);
  const offset = useLogsStore((s) => s.offset);
  const autoRefresh = useLogsStore((s) => s.autoRefresh);
  const setLines = useLogsStore((s) => s.setLines);
  const appendLines = useLogsStore((s) => s.appendLines);
  const setOffset = useLogsStore((s) => s.setOffset);
  const setRefreshing = useLogsStore((s) => s.setRefreshing);
  const setClearing = useLogsStore((s) => s.setClearing);
  const reset = useLogsStore((s) => s.reset);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (offset === 0) {
        const result = await ipc().tailAgentLogs(filter || null, LOGS_INITIAL_LINES, 0);
        setLines(result.lines);
        setOffset(result.size);
      } else {
        const result = await ipc().tailAgentLogs(filter || null, LOGS_INITIAL_LINES, offset);
        if (result.lines.length > 0) appendLines(result.lines);
        if (result.size !== offset) setOffset(result.size);
      }
    } catch {
      // ignore — leave existing logs visible
    } finally {
      setRefreshing(false);
    }
  }, [filter, offset, setLines, appendLines, setOffset, setRefreshing]);

  useEffect(() => {
    void refresh();
    // We intentionally depend only on `filter` here — initial load on switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  usePolling(refresh, AUTO_REFRESH_MS, autoRefresh);

  const clearRange = useCallback(
    async (start: string, end: string) => {
      setClearing(true);
      try {
        await ipc().clearLogsInRange(start, end);
        reset();
        await refresh();
      } finally {
        setClearing(false);
      }
    },
    [refresh, reset, setClearing],
  );

  const copy = useCallback(async () => {
    const text = useLogsStore.getState().lines.join('\n');
    await navigator.clipboard.writeText(text);
  }, []);

  return { refresh, clearRange, copy };
}
