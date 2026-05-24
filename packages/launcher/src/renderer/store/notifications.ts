import { create } from 'zustand'
import type { NotifInput, NotifPrefs, NotifRecord } from '../types'

interface NotifState {
  items: NotifRecord[]
  prefs: NotifPrefs | null
  unread: number
  init: () => Promise<void>
  refresh: () => Promise<void>
  push: (input: NotifInput) => Promise<NotifRecord | null>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  clear: (id?: string) => Promise<void>
  setPrefs: (prefs: Partial<NotifPrefs>) => Promise<void>
}

function countUnread(list: NotifRecord[]): number {
  return list.reduce((n, r) => (r.read ? n : n + 1), 0)
}

let _bound = false

export const useNotificationsStore = create<NotifState>((set, get) => ({
  items: [],
  prefs: null,
  unread: 0,
  init: async () => {
    if (_bound) return
    _bound = true
    try {
      const [list, prefs] = await Promise.all([
        window.api.notificationsList(),
        window.api.notificationsGetPrefs(),
      ])
      set({ items: list, unread: countUnread(list), prefs })
      window.api.onNotificationsUpdated((next) => {
        set({ items: next, unread: countUnread(next) })
      })
    } catch (err) {
      console.error('notifications init failed:', err)
    }
  },
  refresh: async () => {
    const list = await window.api.notificationsList()
    set({ items: list, unread: countUnread(list) })
  },
  push: async (input) => {
    try {
      const rec = await window.api.notificationsPush(input)
      return rec
    } catch (err) {
      console.error('notifications push failed:', err)
      return null
    }
  },
  markRead: async (id) => {
    await window.api.notificationsMarkRead(id)
    await get().refresh()
  },
  markAllRead: async () => {
    await window.api.notificationsMarkAllRead()
    await get().refresh()
  },
  clear: async (id) => {
    await window.api.notificationsClear(id)
    await get().refresh()
  },
  setPrefs: async (next) => {
    const prefs = await window.api.notificationsSetPrefs(next)
    set({ prefs })
  },
}))
