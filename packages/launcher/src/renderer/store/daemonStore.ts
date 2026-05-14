import { create } from 'zustand';

import type { Agent, CoreUpdateInfo, RuntimeInfo } from '@shared/models';

export type DaemonState = 'online' | 'offline' | 'partial' | 'unknown';

interface DaemonStoreState {
  state: DaemonState;
  runtime: RuntimeInfo | null;
  launcherVersion: string | null;
  coreUpdate: CoreUpdateInfo | null;

  setStateFromAgents(agents: Agent[]): void;
  setRuntime(info: RuntimeInfo): void;
  setLauncherVersion(version: string | null): void;
  setCoreUpdate(info: CoreUpdateInfo | null): void;
}

export const useDaemonStore = create<DaemonStoreState>((set) => ({
  state: 'unknown',
  runtime: null,
  launcherVersion: null,
  coreUpdate: null,

  setStateFromAgents: (agents) =>
    set(() => {
      if (agents.length === 0) return { state: 'offline' };
      const online = agents.filter((a) => a.state === 'online' || a.state === 'running' || a.state === 'idle').length;
      if (online === 0) return { state: 'offline' };
      if (online === agents.length) return { state: 'online' };
      return { state: 'partial' };
    }),
  setRuntime: (info) => set({ runtime: info }),
  setLauncherVersion: (version) => set({ launcherVersion: version }),
  setCoreUpdate: (info) => set({ coreUpdate: info }),
}));
