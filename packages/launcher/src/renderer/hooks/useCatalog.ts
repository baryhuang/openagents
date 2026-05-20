import { useEffect, useRef, useCallback } from 'react'
import { useCatalogStore } from '../store/catalog'

/**
 * Loads catalog + supported types into the catalog store once on mount.
 * Components read `useCatalogStore(s => s.catalog)` directly.
 */
export function useCatalog(): { refresh: () => void } {
  const setCatalog       = useCatalogStore((s) => s.setCatalog)
  const setSupportedTypes = useCatalogStore((s) => s.setSupportedTypes)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const [catalog, types] = await Promise.all([
        window.api.getCatalog(),
        window.api.getSupportedAgentTypes(),
      ])
      if (!mounted.current) return
      setCatalog(catalog)
      setSupportedTypes(types || [])
    } catch {}
  }, [setCatalog, setSupportedTypes])

  useEffect(() => {
    mounted.current = true
    refresh()
    return () => { mounted.current = false }
  }, [refresh])

  return { refresh }
}
