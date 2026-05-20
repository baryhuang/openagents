import { useCallback, useEffect, useState } from "react"

type DismissalKind = "ignored" | "later"

interface DismissalEntry {
  kind: DismissalKind
  version: string
  // For "later": ISO timestamp when the dismissal expires. For "ignored":
  // not set — the entry is sticky until the version pointer moves on.
  until?: string
}

type DismissalMap = Record<string, DismissalEntry>

const STORAGE_KEY = "openagents:updateDismissals/v1"
const LATER_HOURS = 24

function readDismissals(): DismissalMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as DismissalMap) : {}
  } catch {
    return {}
  }
}

function writeDismissals(map: DismissalMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / private-mode errors
  }
}

/**
 * Per-agent dismissal state for the Dashboard "Update available" banner
 * (stage.md §2.6). Two flavours:
 *
 *   - **ignored** — sticky until the agent's `latest` pointer moves to a
 *     newer version than the one that was ignored. Once npm publishes
 *     v1.2.4, an `ignored` entry against v1.2.3 stops applying.
 *
 *   - **later** — temporary, expires after 24h. Useful for "don't bug me
 *     right now."
 *
 * Stored in localStorage so a launcher restart preserves the choice but the
 * main process / installer doesn't need to track it.
 */
export function useUpdateDismissals(): {
  isDismissed: (name: string, latest: string | null) => boolean
  ignore: (name: string, latest: string) => void
  later: (name: string, latest: string) => void
  clear: (name: string) => void
} {
  const [map, setMap] = useState<DismissalMap>(() => readDismissals())

  // Re-evaluate periodically so a `later` dismissal that just expired stops
  // suppressing the banner without requiring a page reload.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const persist = useCallback((next: DismissalMap) => {
    writeDismissals(next)
    setMap(next)
  }, [])

  const isDismissed = useCallback(
    (name: string, latest: string | null): boolean => {
      const entry = map[name]
      if (!entry || !latest) return false
      if (entry.version !== latest) return false
      if (entry.kind === "ignored") return true
      if (entry.kind === "later" && entry.until) {
        return Date.now() < new Date(entry.until).getTime()
      }
      return false
    },
    [map],
  )

  const ignore = useCallback(
    (name: string, latest: string) => {
      persist({ ...map, [name]: { kind: "ignored", version: latest } })
    },
    [map, persist],
  )

  const later = useCallback(
    (name: string, latest: string) => {
      const until = new Date(Date.now() + LATER_HOURS * 60 * 60 * 1000).toISOString()
      persist({ ...map, [name]: { kind: "later", version: latest, until } })
    },
    [map, persist],
  )

  const clear = useCallback(
    (name: string) => {
      if (!map[name]) return
      const next = { ...map }
      delete next[name]
      persist(next)
    },
    [map, persist],
  )

  return { isDismissed, ignore, later, clear }
}
