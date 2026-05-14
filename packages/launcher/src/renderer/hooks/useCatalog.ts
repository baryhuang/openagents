import { useCallback, useEffect } from 'react';

import { ipc } from '../lib/api';
import { useCatalogStore } from '../store/catalogStore';

interface UseCatalogResult {
  refresh: () => Promise<void>;
}

export function useCatalog({ autoLoad = true }: { autoLoad?: boolean } = {}): UseCatalogResult {
  const setEntries = useCatalogStore((s) => s.setEntries);
  const setLoading = useCatalogStore((s) => s.setLoading);
  const setError = useCatalogStore((s) => s.setError);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await ipc().getCatalog();
      setEntries(entries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setEntries, setLoading, setError]);

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, refresh]);

  return { refresh };
}
