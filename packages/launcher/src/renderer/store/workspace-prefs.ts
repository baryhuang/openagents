import { create } from 'zustand'

const STORAGE_KEY = 'workspace-prefs:v1'

interface PersistShape {
  favorites: string[]                       // workspace ids
  lastUsedAt: Record<string, string>        // workspace id → ISO timestamp
  groups: Record<string, string>            // workspace id → group label
}

function load(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { favorites: [], lastUsedAt: {}, groups: {} }
    const parsed = JSON.parse(raw) as Partial<PersistShape>
    return {
      favorites: parsed.favorites || [],
      lastUsedAt: parsed.lastUsedAt || {},
      groups: parsed.groups || {},
    }
  } catch {
    return { favorites: [], lastUsedAt: {}, groups: {} }
  }
}

function save(state: PersistShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

interface WorkspacePrefsState {
  favorites: Set<string>
  lastUsedAt: Record<string, string>
  groups: Record<string, string>
  toggleFavorite: (id: string) => void
  markUsed: (id: string) => void
  setGroup: (id: string, group: string) => void
}

export const useWorkspacePrefs = create<WorkspacePrefsState>((set, get) => {
  const initial = load()
  return {
    favorites: new Set(initial.favorites),
    lastUsedAt: initial.lastUsedAt,
    groups: initial.groups,
    toggleFavorite: (id) => {
      const fav = new Set(get().favorites)
      if (fav.has(id)) fav.delete(id)
      else fav.add(id)
      set({ favorites: fav })
      save({ favorites: Array.from(fav), lastUsedAt: get().lastUsedAt, groups: get().groups })
    },
    markUsed: (id) => {
      const next = { ...get().lastUsedAt, [id]: new Date().toISOString() }
      set({ lastUsedAt: next })
      save({ favorites: Array.from(get().favorites), lastUsedAt: next, groups: get().groups })
    },
    setGroup: (id, group) => {
      const next = { ...get().groups }
      if (group) next[id] = group
      else delete next[id]
      set({ groups: next })
      save({ favorites: Array.from(get().favorites), lastUsedAt: get().lastUsedAt, groups: next })
    },
  }
})
