import { create } from 'zustand';

import type { AppSettings } from '@shared/models';

interface SettingsStoreState {
  settings: AppSettings;
  loading: boolean;

  setSettings(settings: AppSettings): void;
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void;
  setLoading(loading: boolean): void;
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  settings: {},
  loading: false,
  setSettings: (settings) => set({ settings }),
  setSetting: (key, value) =>
    set((state) => ({ settings: { ...state.settings, [key]: value } })),
  setLoading: (loading) => set({ loading }),
}));
