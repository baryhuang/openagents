import { create } from 'zustand'
import type { Agent } from '../types'

export type DaemonState = 'running' | 'starting' | 'stopped' | 'offline'

interface AgentsState {
  agents: Agent[]
  setAgents: (agents: Agent[]) => void

  pendingAgentActions: Set<string>
  addPendingAction: (name: string) => void
  removePendingAction: (name: string) => void

  coreVersion: string | null
  setCoreVersion: (v: string | null) => void
  launcherVersion: string | null
  setLauncherVersion: (v: string | null) => void

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

// Derive daemon liveness from the agent list, matching the legacy launcher.
// running   — any agent is online/running/idle
// starting  — any agent is starting/reconnecting
// stopped   — agents exist but none are running
// offline   — no agents configured
export function useDaemonStatus(): DaemonState {
  return useAgentsStore((s) => {
    const agents = s.agents
    if (agents.some((a) => a.state === 'online' || a.state === 'running' || a.state === 'idle')) return 'running'
    if (agents.some((a) => a.state === 'starting' || a.state === 'reconnecting')) return 'starting'
    if (agents.length > 0) return 'stopped'
    return 'offline'
  })
}
