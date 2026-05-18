import { useEffect, useRef, useCallback } from 'react'
import { useAgentsStore } from '../store/agents'
import { useShallow } from 'zustand/react/shallow'

/**
 * Polls window.api.listAgents() and writes results into the agents store.
 * Dedup via inFlight ref — only one request runs at a time.
 */
export function useAgents(intervalMs = 5000): void {
  const { setAgents, setCoreVersion, setLauncherVersion, setDaemonState } = useAgentsStore(
    useShallow((s) => ({
      setAgents: s.setAgents,
      setCoreVersion: s.setCoreVersion,
      setLauncherVersion: s.setLauncherVersion,
      setDaemonState: s.setDaemonState,
    })),
  )
  const inFlight = useRef(false)
  const queued   = useRef(false)
  const mounted  = useRef(true)

  const refresh = useCallback(async () => {
    if (inFlight.current) { queued.current = true; return }
    inFlight.current = true
    try {
      const [agents, status, daemon] = await Promise.all([
        window.api.listAgents(),
        window.api.pythonStatus(),
        window.api.daemonStatus().catch(() => ({ state: 'offline' as const, pid: null })),
      ])
      if (!mounted.current) return
      setAgents(agents)
      setCoreVersion(status.sdkVersion)
      setLauncherVersion(`v${status.launcherVersion}`)
      setDaemonState(daemon.state)
    } catch {
      // IPC error — keep stale data
    } finally {
      inFlight.current = false
      if (queued.current) { queued.current = false; refresh() }
    }
  }, [setAgents, setCoreVersion, setLauncherVersion, setDaemonState])

  useEffect(() => {
    mounted.current = true
    refresh()
    if (intervalMs <= 0) return
    const id = setInterval(refresh, intervalMs)
    return () => { mounted.current = false; clearInterval(id) }
  }, [refresh, intervalMs])
}
