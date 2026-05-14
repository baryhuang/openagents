import { useCallback, useEffect } from 'react';

import type { AppSettings } from '@shared/models';

import { ipc } from '../lib/api';
import { useSettingsStore } from '../store/settingsStore';

interface UseSettingsResult {
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}

export function useSettings({ autoLoad = true }: { autoLoad?: boolean } = {}): UseSettingsResult {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const setLoading = useSettingsStore((s) => s.setLoading);

  useEffect(() => {
    if (!autoLoad) return;
    setLoading(true);
    void ipc()
      .getSetting()
      .then((s) => {
        if (s && typeof s === 'object') setSettings(s as AppSettings);
      })
      .finally(() => setLoading(false));
  }, [autoLoad, setSettings, setLoading]);

  const setSettingPersistent = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSetting(key, value);
      await ipc().setSetting(key, value);
    },
    [setSetting],
  );

  return { setSetting: setSettingPersistent };
}
