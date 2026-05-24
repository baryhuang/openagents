import { create } from 'zustand'
import type { GitHubBinding } from '../types'

interface GitHubState {
  bindings: GitHubBinding[]
  loading: boolean
  setBindings: (b: GitHubBinding[]) => void
  refresh: () => Promise<void>
}

export const useGitHubStore = create<GitHubState>((set, get) => ({
  bindings: [],
  loading: false,
  setBindings: (bindings) => set({ bindings }),
  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const data = await window.api.githubListBindings()
      set({ bindings: data })
    } catch (err) {
      console.error('githubListBindings failed:', err)
    } finally {
      set({ loading: false })
    }
  },
}))
