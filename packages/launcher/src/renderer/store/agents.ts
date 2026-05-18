import { create } from 'zustand'
import type { Agent } from '../types'

export type DaemonState = 'online' | 'starting' | 'offline'

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

  // Daemon process liveness, polled from main via agents:daemon-status IPC.
  // We can't derive this from the agent list — "no agents configured" must
  // not look identical to "daemon crashed".
  daemonState: DaemonState
  setDaemonState: (s: DaemonState) => void
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

  daemonState: 'offline',
  setDaemonState: (s) => set({ daemonState: s }),
}))

export function useDaemonStatus(): DaemonState {
  return useAgentsStore((s) => s.daemonState)
}
