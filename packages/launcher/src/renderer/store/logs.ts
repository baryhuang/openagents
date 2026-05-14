import { create } from 'zustand'

interface LogsState {
  // Active agent filter — replaces legacy _logsFilter
  agentFilter: string
  setAgentFilter: (filter: string) => void

  // File read position — replaces legacy _logsOffset (persisted across tab switches)
  logsOffset: number
  setLogsOffset: (offset: number) => void
  resetLogsOffset: () => void

  // Clear operation guard — replaces legacy _clearLogsInFlight
  clearInFlight: boolean
  setClearInFlight: (v: boolean) => void
}

export const useLogsStore = create<LogsState>((set) => ({
  agentFilter: '',
  setAgentFilter: (filter) => set({ agentFilter: filter, logsOffset: 0 }),

  logsOffset: 0,
  setLogsOffset: (offset) => set({ logsOffset: offset }),
  resetLogsOffset: () => set({ logsOffset: 0 }),

  clearInFlight: false,
  setClearInFlight: (v) => set({ clearInFlight: v }),
}))
