import { create } from 'zustand'
import type { ConnectionRecord } from '../types'

interface ConnectionsState {
  connections: ConnectionRecord[]
  loading: boolean
  setConnections: (c: ConnectionRecord[]) => void
  setLoading: (b: boolean) => void
  refresh: () => Promise<void>
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  loading: false,
  setConnections: (connections) => set({ connections }),
  setLoading: (loading) => set({ loading }),
  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const data = await window.api.listConnections()
      set({ connections: data })
    } catch (err) {
      console.error('listConnections failed:', err)
    } finally {
      set({ loading: false })
    }
  },
}))
