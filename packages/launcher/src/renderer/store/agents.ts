import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Agent } from '../types'

interface AgentsState {
  // Agent list — replaces legacy module-level agent array
  agents: Agent[]
  setAgents: (agents: Agent[]) => void

  // Pending start/stop — replaces legacy _pendingAgentActions Set
  pendingAgentActions: Set<string>
  addPendingAction: (name: string) => void
  removePendingAction: (name: string) => void

  // Version info (fetched alongside agent list)
  coreVersion: string | null
  setCoreVersion: (v: string | null) => void
  launcherVersion: string | null
  setLauncherVersion: (v: string | null) => void

  // Core update banner
  coreUpdateInfo: { current: string; latest: string } | null
  setCoreUpdateInfo: (info: { current: string; latest: string } | null) => void
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  setAgents: (agents) => set({ agents }),

  pendingAgentActions: new Set<string>(),
  addPendingAction: (name) =>
    set((state) => ({ pendingAgentActions: new Set(state.pendingAgentActions).add(name) })),
  removePendingAction: (name) =>
    set((state) => {
      const next = new Set(state.pendingAgentActions)
      next.delete(name)
      return { pendingAgentActions: next }
    }),

  coreVersion: null,
  setCoreVersion: (v) => set({ coreVersion: v }),
  launcherVersion: null,
  setLauncherVersion: (v) => set({ launcherVersion: v }),

  coreUpdateInfo: null,
  setCoreUpdateInfo: (info) => set({ coreUpdateInfo: info }),
}))

/** Derived selector — computed from agent states, no extra polling needed */
export function useDaemonStatus(): 'online' | 'offline' | 'starting' {
  const agents = useAgentsStore(useShallow((s) => s.agents))
  if (agents.some((a) => ['online', 'running', 'idle'].includes(a.state))) return 'online'
  if (agents.some((a) => ['starting', 'reconnecting'].includes(a.state))) return 'starting'
  return 'offline'
}
