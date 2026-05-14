import { useCallback, useEffect } from 'react';

import { ipc } from '../lib/api';
import { useDaemonStore } from '../store/daemonStore';

interface UseDaemonStatusResult {
  refreshRuntime: () => Promise<void>;
}

/**
 * Loads runtime info (Node/npm/core versions) and exposes a refresh function.
 * Subscribes to core-update-available events from main.
 */
export function useDaemonStatus({ autoLoad = true }: { autoLoad?: boolean } = {}): UseDaemonStatusResult {
  const setRuntime = useDaemonStore((s) => s.setRuntime);
  const setLauncherVersion = useDaemonStore((s) => s.setLauncherVersion);
  const setCoreUpdate = useDaemonStore((s) => s.setCoreUpdate);

  const refreshRuntime = useCallback(async () => {
    const info = await ipc().runtimeInfo();
    setRuntime(info);
  }, [setRuntime]);

  useEffect(() => {
    if (!autoLoad) return;
    void refreshRuntime();
    void ipc()
      .pythonStatus()
      .then((status) => setLauncherVersion(status.launcherVersion))
      .catch(() => undefined);
  }, [autoLoad, refreshRuntime, setLauncherVersion]);

  useEffect(() => {
    ipc().onCoreUpdate((info) => setCoreUpdate(info));
  }, [setCoreUpdate]);

  return { refreshRuntime };
}
