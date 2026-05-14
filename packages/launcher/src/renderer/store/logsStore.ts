import { create } from 'zustand';

export const LOGS_INITIAL_LINES = 200;
export const LOGS_MAX_BUFFER_LINES = 400;

interface LogsStoreState {
  filter: string;
  lines: string[];
  offset: number;
  autoRefresh: boolean;
  refreshing: boolean;
  clearing: boolean;

  setFilter(filter: string): void;
  setLines(lines: string[]): void;
  appendLines(lines: string[]): void;
  setOffset(offset: number): void;
  setAutoRefresh(enabled: boolean): void;
  setRefreshing(refreshing: boolean): void;
  setClearing(clearing: boolean): void;
  reset(): void;
}

export const useLogsStore = create<LogsStoreState>((set) => ({
  filter: '',
  lines: [],
  offset: 0,
  autoRefresh: true,
  refreshing: false,
  clearing: false,

  setFilter: (filter) => set({ filter, lines: [], offset: 0 }),
  setLines: (lines) => set({ lines }),
  appendLines: (newLines) =>
    set((state) => {
      const combined = [...state.lines, ...newLines];
      const sliced = combined.length > LOGS_MAX_BUFFER_LINES
        ? combined.slice(combined.length - LOGS_MAX_BUFFER_LINES)
        : combined;
      return { lines: sliced };
    }),
  setOffset: (offset) => set({ offset }),
  setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
  setRefreshing: (refreshing) => set({ refreshing }),
  setClearing: (clearing) => set({ clearing }),
  reset: () => set({ lines: [], offset: 0, refreshing: false, clearing: false }),
}));
