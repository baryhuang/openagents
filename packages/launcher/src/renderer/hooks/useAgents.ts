import { useCallback, useEffect } from 'react';

import type { AddAgentConfig } from '@shared/models';

import { ipc } from '../lib/api';
import { useAgentsStore } from '../store/agentsStore';
import { useDaemonStore } from '../store/daemonStore';

import { usePolling } from './usePolling';

interface UseAgentsResult {
  refresh: () => Promise<void>;
  addAgent: (config: AddAgentConfig) => Promise<void>;
  removeAgent: (name: string) => Promise<void>;
  startAgent: (name: string) => Promise<void>;
  stopAgent: (name: string) => Promise<void>;
  toggleAgent: (name: string, currentState: string) => Promise<void>;
}

/**
 * Source-of-truth hook for the agents list. Auto-polls when `pollMs > 0`.
 * Updates the agents and daemon Zustand stores.
 */
export function useAgents({ pollMs = 0, autoLoad = true }: { pollMs?: number; autoLoad?: boolean } = {}): UseAgentsResult {
  const setAgents = useAgentsStore((s) => s.setAgents);
  const setLoading = useAgentsStore((s) => s.setLoading);
  const setError = useAgentsStore((s) => s.setError);
  const markPending = useAgentsStore((s) => s.markPending);
  const clearPending = useAgentsStore((s) => s.clearPending);
  const setStateFromAgents = useDaemonStore((s) => s.setStateFromAgents);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const agents = await ipc().listAgents();
      setAgents(agents);
      setStateFromAgents(agents);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setAgents, setLoading, setError, setStateFromAgents]);

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, refresh]);

  usePolling(refresh, pollMs, pollMs > 0);

  const addAgent = useCallback(
    async (config: AddAgentConfig) => {
      await ipc().addAgent(config);
      await refresh();
    },
    [refresh],
  );

  const removeAgent = useCallback(
    async (name: string) => {
      await ipc().removeAgent(name);
      await refresh();
    },
    [refresh],
  );

  const startAgent = useCallback(
    async (name: string) => {
      markPending(name);
      try {
        await ipc().startAgent(name);
      } finally {
        // Polling will reflect the new state; clear pending after a short delay
        // so the UI doesn't show stale "starting…" state forever.
        setTimeout(() => clearPending(name), 1500);
      }
    },
    [markPending, clearPending],
  );

  const stopAgent = useCallback(
    async (name: string) => {
      markPending(name);
      try {
        await ipc().stopAgent(name);
      } finally {
        setTimeout(() => clearPending(name), 1500);
      }
    },
    [markPending, clearPending],
  );

  const toggleAgent = useCallback(
    async (name: string, currentState: string) => {
      const isRunning = currentState === 'online' || currentState === 'running' || currentState === 'idle';
      if (isRunning) await stopAgent(name);
      else await startAgent(name);
    },
    [startAgent, stopAgent],
  );

  return { refresh, addAgent, removeAgent, startAgent, stopAgent, toggleAgent };
}
