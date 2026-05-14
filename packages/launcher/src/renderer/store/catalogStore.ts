import { create } from 'zustand';

import type { CatalogEntry } from '@shared/models';

interface CatalogStoreState {
  entries: CatalogEntry[];
  loading: boolean;
  error: string | null;
  query: string;

  setEntries(entries: CatalogEntry[]): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  setQuery(query: string): void;
}

export const useCatalogStore = create<CatalogStoreState>((set) => ({
  entries: [],
  loading: false,
  error: null,
  query: '',

  setEntries: (entries) => set({ entries, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setQuery: (query) => set({ query }),
}));
