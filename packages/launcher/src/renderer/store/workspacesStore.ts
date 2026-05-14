import { create } from 'zustand';

import type { Workspace } from '@shared/models';

interface WorkspacesStoreState {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;

  setWorkspaces(workspaces: Workspace[]): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
}

export const useWorkspacesStore = create<WorkspacesStoreState>((set) => ({
  workspaces: [],
  loading: false,
  error: null,
  setWorkspaces: (workspaces) => set({ workspaces, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
