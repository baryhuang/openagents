import { create } from 'zustand'
import type { RuntimeInfo } from '../types'

interface SettingsState {
  startOnBoot: boolean
  setStartOnBoot: (v: boolean) => void

  minimizeToTray: boolean
  setMinimizeToTray: (v: boolean) => void

  runtimeInfo: RuntimeInfo | null
  setRuntimeInfo: (info: RuntimeInfo | null) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  startOnBoot: false,
  setStartOnBoot: (v) => set({ startOnBoot: v }),

  minimizeToTray: false,
  setMinimizeToTray: (v) => set({ minimizeToTray: v }),

  runtimeInfo: null,
  setRuntimeInfo: (info) => set({ runtimeInfo: info }),
}))
