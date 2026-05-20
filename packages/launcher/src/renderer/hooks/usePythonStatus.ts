import { useState, useEffect, useRef, useCallback } from 'react'
import { useAgentsStore } from '../store/agents'
import { useShallow } from 'zustand/react/shallow'
import type { PythonStatus } from '../types'

interface UsePythonStatusResult {
  status: PythonStatus | null
  loading: boolean
  refresh: () => void
}

/**
 * Fetches python/SDK status and keeps version info in the agents store.
 * Polls at the given interval; pass 0 to fetch once.
 */
export function usePythonStatus(intervalMs = 10000): UsePythonStatusResult {
  const { setCoreVersion, setLauncherVersion } = useAgentsStore(
    useShallow((s) => ({ setCoreVersion: s.setCoreVersion, setLauncherVersion: s.setLauncherVersion })),
  )
  const [status, setStatus] = useState<PythonStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.pythonStatus()
      if (!mounted.current) return
      setStatus(s)
      setCoreVersion(s.sdkVersion || null)
      if (s.launcherVersion) setLauncherVersion(`v${s.launcherVersion}`)
      setLoading(false)
    } catch {
      if (mounted.current) setLoading(false)
    }
  }, [setCoreVersion, setLauncherVersion])

  useEffect(() => {
    mounted.current = true
    refresh()
    if (intervalMs <= 0) return
    const id = setInterval(refresh, intervalMs)
    return () => { mounted.current = false; clearInterval(id) }
  }, [refresh, intervalMs])

  return { status, loading, refresh }
}
