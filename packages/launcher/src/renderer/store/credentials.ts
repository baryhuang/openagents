import { create } from 'zustand'
import type { CredentialSummary } from '../types'

interface CredentialsState {
  credentials: CredentialSummary[]
  loading: boolean
  setCredentials: (c: CredentialSummary[]) => void
  setLoading: (b: boolean) => void
  refresh: () => Promise<void>
}

export const useCredentialsStore = create<CredentialsState>((set, get) => ({
  credentials: [],
  loading: false,
  setCredentials: (credentials) => set({ credentials }),
  setLoading: (loading) => set({ loading }),
  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const data = await window.api.listCredentials()
      set({ credentials: data })
    } catch (err) {
      console.error('listCredentials failed:', err)
    } finally {
      set({ loading: false })
    }
  },
}))
