import { create } from 'zustand'
import type { CatalogEntry } from '../types'

interface CatalogState {
  // Full catalog — shared by Install page and NewAgent dialog
  catalog: CatalogEntry[]
  setCatalog: (catalog: CatalogEntry[]) => void

  // Supported types returned by getSupportedAgentTypes()
  supportedTypes: string[]
  setSupportedTypes: (types: string[]) => void
}

export const useCatalogStore = create<CatalogState>((set) => ({
  catalog: [],
  setCatalog: (catalog) => set({ catalog }),

  supportedTypes: [],
  setSupportedTypes: (types) => set({ supportedTypes: types }),
}))
