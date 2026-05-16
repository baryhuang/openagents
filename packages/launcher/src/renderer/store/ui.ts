import { create } from 'zustand'

interface ActivityEntry {
  time: string
  msg: string
}

interface UiState {
  // Active tab — replaces legacy _currentTab
  currentTab: string
  setCurrentTab: (tab: string) => void

  // Deep-link request: when set, the Install page should auto-open this agent's
  // detail view (used by Dashboard banner click and tray-menu update items).
  installFocusAgent: string | null
  setInstallFocusAgent: (name: string | null) => void

  // Bumped each time the user explicitly clicks the Install sidebar tab.
  // The Install page watches this and clears any open detail view so the
  // user always lands on the marketplace list when entering via the tab.
  installListSignal: number
  goToInstallList: () => void

  // Activity log — replaces legacy activityEntries[]
  activityLog: ActivityEntry[]
  addActivity: (msg: string) => void

  // Cached icons directory path — replaces legacy _coreIconsDir
  coreIconsDir: string | null
  setCoreIconsDir: (dir: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  currentTab: 'dashboard',
  setCurrentTab: (tab) => set({ currentTab: tab }),

  installFocusAgent: null,
  setInstallFocusAgent: (name) => set({ installFocusAgent: name }),

  installListSignal: 0,
  goToInstallList: () =>
    set((s) => ({ currentTab: 'install', installListSignal: s.installListSignal + 1 })),

  activityLog: [],
  addActivity: (msg) => {
    const now = new Date()
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    set((state) => ({
      activityLog: [{ time, msg }, ...state.activityLog].slice(0, 50),
    }))
  },

  coreIconsDir: null,
  setCoreIconsDir: (dir) => set({ coreIconsDir: dir }),
}))
