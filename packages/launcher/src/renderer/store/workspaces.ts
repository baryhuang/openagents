import { create } from 'zustand'
import type { Workspace } from '../types'

interface WorkspacesState {
  // Workspace list — shared between Agents page and Settings page
  workspaces: Workspace[]
  setWorkspaces: (workspaces: Workspace[]) => void
}

export const useWorkspacesStore = create<WorkspacesState>((set) => ({
  workspaces: [],
  setWorkspaces: (workspaces) => set({ workspaces }),
}))
