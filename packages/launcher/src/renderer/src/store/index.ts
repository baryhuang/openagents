import { create } from 'zustand'
import type { Agent } from '../types'

interface ActivityEntry {
  time: string
  msg: string
}

interface AppState {
  currentTab: string
  setCurrentTab: (tab: string) => void

  agents: Agent[]
  setAgents: (agents: Agent[]) => void

  pendingAgentActions: Set<string>
  addPendingAction: (name: string) => void
  removePendingAction: (name: string) => void

  activityLog: ActivityEntry[]
  addActivity: (msg: string) => void

  coreVersion: string | null
  setCoreVersion: (v: string | null) => void
  launcherVersion: string | null
  setLauncherVersion: (v: string | null) => void

  coreUpdateInfo: { current: string; latest: string } | null
  setCoreUpdateInfo: (info: { current: string; latest: string } | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentTab: 'dashboard',
  setCurrentTab: (tab) => set({ currentTab: tab }),

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

  activityLog: [],
  addActivity: (msg) => {
    const now = new Date()
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    set((state) => ({
      activityLog: [{ time, msg }, ...state.activityLog].slice(0, 50),
    }))
  },

  coreVersion: null,
  setCoreVersion: (v) => set({ coreVersion: v }),
  launcherVersion: null,
  setLauncherVersion: (v) => set({ launcherVersion: v }),

  coreUpdateInfo: null,
  setCoreUpdateInfo: (info) => set({ coreUpdateInfo: info }),
}))

export function useDaemonStatus(): 'online' | 'offline' | 'starting' {
  const agents = useAppStore((s) => s.agents)
  if (agents.some((a) => ['online', 'running', 'idle'].includes(a.state))) return 'online'
  if (agents.some((a) => ['starting', 'reconnecting'].includes(a.state))) return 'starting'
  return 'offline'
}
