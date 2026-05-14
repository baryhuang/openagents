import { useEffect, useRef, useCallback } from 'react'
import { useWorkspacesStore } from '../store/workspaces'

interface UseWorkspacesResult {
  refresh: () => Promise<void>
}

/**
 * Loads the workspace list into the workspaces store.
 * Components read `useWorkspacesStore(s => s.workspaces)` directly.
 * Call `refresh()` after any mutating operation.
 */
export function useWorkspaces(): UseWorkspacesResult {
  const setWorkspaces = useWorkspacesStore((s) => s.setWorkspaces)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const ws = await window.api.listWorkspaces()
      if (mounted.current) setWorkspaces(ws)
    } catch {}
  }, [setWorkspaces])

  useEffect(() => {
    mounted.current = true
    refresh()
    return () => { mounted.current = false }
  }, [refresh])

  return { refresh }
}
