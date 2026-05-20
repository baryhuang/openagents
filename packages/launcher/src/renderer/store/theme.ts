import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'launcher:theme-mode'

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {}
  return 'system'
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

function apply(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

interface ThemeState {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (m: ThemeMode) => void
  init: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readStoredMode(),
  resolved: resolve(readStoredMode()),
  setMode: (mode) => {
    try { localStorage.setItem(STORAGE_KEY, mode) } catch {}
    const resolved = resolve(mode)
    apply(resolved)
    set({ mode, resolved })
  },
  init: () => {
    const { mode } = get()
    const resolved = resolve(mode)
    apply(resolved)
    set({ resolved })
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (): void => {
        if (get().mode !== 'system') return
        const r = mq.matches ? 'dark' : 'light'
        apply(r)
        set({ resolved: r })
      }
      try { mq.addEventListener('change', handler) } catch {
        mq.addListener(handler)
      }
    }
  },
}))
