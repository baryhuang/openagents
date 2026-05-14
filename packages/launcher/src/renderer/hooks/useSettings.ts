import { useState, useEffect, useCallback } from 'react'

interface UseSettingResult<T> {
  value: T | undefined
  loading: boolean
  save: (v: T) => Promise<void>
}

/**
 * Read and write a single persisted setting via IPC.
 * Value is kept in local state; `save` writes through to the main process.
 */
export function useSetting<T = unknown>(key: string): UseSettingResult<T> {
  const [value, setValue] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.getSetting(key)
      .then((v) => {
        setValue(v as T)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [key])

  const save = useCallback(async (v: T) => {
    setValue(v)
    await window.api.setSetting(key, v)
  }, [key])

  return { value, loading, save }
}

interface UseAgentLogsResult {
  lines: string[]
  loading: boolean
  refresh: () => void
}

/**
 * Fetches the last N lines of logs for a specific agent.
 * Optionally polls at `intervalMs`; pass 0 to disable polling.
 */
export function useAgentLogs(name: string, lineCount = 200, intervalMs = 3000): UseAgentLogsResult {
  const [lines, setLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!name) return
    try {
      const result = await window.api.agentLogs(name, lineCount)
      setLines(result.lines)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [name, lineCount])

  useEffect(() => {
    if (!name) return
    refresh()
    if (intervalMs <= 0) return
    const id = setInterval(refresh, intervalMs)
    return () => clearInterval(id)
  }, [refresh, intervalMs, name])

  return { lines, loading, refresh }
}
