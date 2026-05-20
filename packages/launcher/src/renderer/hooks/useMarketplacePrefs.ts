import { useEffect, useState } from "react"

const STORAGE_KEY = "oa.marketplace.prefs.v1"

export type MarketplaceSort = "featured" | "newest" | "popular" | "name"
export type MarketplaceView = "grid" | "list"

export interface MarketplacePrefs {
  view: MarketplaceView
  sort: MarketplaceSort
  category: string
}

const DEFAULT_PREFS: MarketplacePrefs = {
  view: "grid",
  sort: "featured",
  category: "all",
}

function readPrefs(): MarketplacePrefs {
  if (typeof localStorage === "undefined") return DEFAULT_PREFS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<MarketplacePrefs>
    return { ...DEFAULT_PREFS, ...parsed }
  } catch {
    return DEFAULT_PREFS
  }
}

/**
 * Persisted user preferences for the marketplace view (stage.md §2.1).
 * Backed by localStorage so the same view/sort/filter survives launcher
 * restarts. Falls back gracefully if localStorage is unavailable (e.g.
 * during SSR-style render in tests).
 */
export function useMarketplacePrefs(): {
  prefs: MarketplacePrefs
  setView: (v: MarketplaceView) => void
  setSort: (s: MarketplaceSort) => void
  setCategory: (c: string) => void
} {
  const [prefs, setPrefs] = useState<MarketplacePrefs>(() => readPrefs())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // ignore quota / private-mode errors
    }
  }, [prefs])

  return {
    prefs,
    setView: (view) => setPrefs((p) => ({ ...p, view })),
    setSort: (sort) => setPrefs((p) => ({ ...p, sort })),
    setCategory: (category) => setPrefs((p) => ({ ...p, category })),
  }
}
