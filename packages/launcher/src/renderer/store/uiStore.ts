import type { ReactNode } from 'react';
import { create } from 'zustand';

import type { TabName } from '@shared/models';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
  expiresAt: number;
}

export interface ActivityEntry {
  id: number;
  kind: ToastKind;
  text: string;
  timestamp: number;
}

const MAX_ACTIVITY = 50;
let toastIdSeq = 0;
let activityIdSeq = 0;

interface UiStoreState {
  currentTab: TabName;
  toasts: ToastMessage[];
  activity: ActivityEntry[];
  modal: ReactNode | null;

  switchTab(tab: TabName): void;
  pushToast(text: string, kind?: ToastKind): number;
  removeToast(id: number): void;
  openModal(content: ReactNode): void;
  closeModal(): void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  currentTab: 'dashboard',
  toasts: [],
  activity: [],
  modal: null,

  switchTab: (tab) => set({ currentTab: tab }),

  pushToast: (text, kind = 'info') => {
    const id = ++toastIdSeq;
    const expiresAt = Date.now() + 4000;
    const activityEntry: ActivityEntry = {
      id: ++activityIdSeq,
      kind,
      text,
      timestamp: Date.now(),
    };
    set((state) => ({
      toasts: [...state.toasts, { id, kind, text, expiresAt }],
      activity: [activityEntry, ...state.activity].slice(0, MAX_ACTIVITY),
    }));
    return id;
  },

  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  openModal: (content) => set({ modal: content }),
  closeModal: () => set({ modal: null }),
}));
