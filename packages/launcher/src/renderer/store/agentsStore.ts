import { create } from 'zustand';

import type { Agent } from '@shared/models';

interface AgentsState {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  /** Names of agents currently being toggled (start/stop). */
  pendingActions: Set<string>;

  setAgents(agents: Agent[]): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  markPending(name: string): void;
  clearPending(name: string): void;
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  loading: false,
  error: null,
  lastUpdatedAt: null,
  pendingActions: new Set<string>(),

  setAgents: (agents) => set({ agents, lastUpdatedAt: Date.now(), error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  markPending: (name) =>
    set((state) => {
      const next = new Set(state.pendingActions);
      next.add(name);
      return { pendingActions: next };
    }),
  clearPending: (name) =>
    set((state) => {
      const next = new Set(state.pendingActions);
      next.delete(name);
      return { pendingActions: next };
    }),
}));
