import { useCallback, useEffect } from 'react';

import { ipc } from '../lib/api';
import { useWorkspacesStore } from '../store/workspacesStore';

interface UseWorkspacesResult {
  refresh: () => Promise<void>;
  create: (name?: string) => Promise<void>;
  remove: (slug: string) => Promise<void>;
  connect: (agentName: string, slug: string) => Promise<void>;
  disconnect: (agentName: string) => Promise<void>;
}

export function useWorkspaces({ autoLoad = true }: { autoLoad?: boolean } = {}): UseWorkspacesResult {
  const setWorkspaces = useWorkspacesStore((s) => s.setWorkspaces);
  const setLoading = useWorkspacesStore((s) => s.setLoading);
  const setError = useWorkspacesStore((s) => s.setError);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ipc().listWorkspaces();
      setWorkspaces(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setError, setLoading, setWorkspaces]);

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, refresh]);

  const create = useCallback(
    async (name?: string) => {
      await ipc().createWorkspace(name);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (slug: string) => {
      await ipc().removeWorkspace(slug);
      await refresh();
    },
    [refresh],
  );

  const connect = useCallback(
    async (agentName: string, slug: string) => {
      await ipc().connectWorkspace(agentName, slug);
    },
    [],
  );

  const disconnect = useCallback(
    async (agentName: string) => {
      await ipc().disconnectWorkspace(agentName);
    },
    [],
  );

  return { refresh, create, remove, connect, disconnect };
}
