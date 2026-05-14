import React, { useEffect, useState, useRef, useCallback } from "react"
import { Button } from "../components/ui/Button"
import { Modal, ModalTitle } from "../components/ui/Modal"
import AgentIcon from "../components/AgentIcon"
import type { CatalogEntry, HealthCheck } from "../types"
import type { ToastType } from "../hooks/useToast"

function formatHealthLabel(health: HealthCheck | null): string {
  if (!health) return "Not configured"
  if (!health.ready) return health.message || "Not configured"
  const parts = ["Ready"]
  if (health.auth_mode === "api_key") parts.push("API key")
  else if (health.auth_mode === "cli_login") parts.push("CLI login")
  if (health.execution_mode && health.execution_mode !== "unavailable")
    parts.push(health.execution_mode)
  return parts.join(" · ")
}

interface InstallProps {
  showToast: (msg: string, type?: ToastType) => void
}

function SkeletonCatalogRow(): React.JSX.Element {
  return (
    <div className="catalog-row">
      <div className="catalog-info">
        <div
          className="skeleton-shimmer"
          style={{ width: 32, height: 32, borderRadius: 8 }}
        />
        <div className="catalog-text">
          <div className="skeleton-shimmer rounded-full h-2.5 w-[40%] mb-1.5" />
          <div className="skeleton-shimmer rounded-full h-2 w-[60%]" />
        </div>
      </div>
    </div>
  )
}

export default function Install({
  showToast,
}: InstallProps): React.JSX.Element {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [healthMap, setHealthMap] = useState<
    Record<string, HealthCheck | null>
  >({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [installing, setInstalling] = useState(false)
  const [installTarget, setInstallTarget] = useState<{
    name: string
    isInstalled: boolean
  } | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<string | null>(null)
  const [installLog, setInstallLog] = useState("")
  const [installDone, setInstallDone] = useState(false)
  const [progressName, setProgressName] = useState<string>("")
  const [progressVerb, setProgressVerb] = useState<string>("Installing")
  const logRef = useRef<HTMLPreElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    try {
      const cat = await window.api.getCatalog()
      if (!mounted.current) return
      setCatalog(cat)
      setLoading(false)
      const healthResults: Record<string, HealthCheck | null> = {}
      await Promise.all(
        cat.map(async (c) => {
          try {
            healthResults[c.name] = await window.api.healthCheck(c.name)
          } catch {
            healthResults[c.name] = null
          }
        }),
      )
      if (mounted.current) setHealthMap(healthResults)
    } catch (err: unknown) {
      console.error("Catalog load error:", err)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCatalog()
    const interval = setInterval(() => {
      if (catalog.length === 0) loadCatalog()
    }, 5000)
    return () => clearInterval(interval)
  }, [loadCatalog, catalog.length])

  const scrollLog = (): void => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }

  const startInstall = async (
    name: string,
    isInstalled: boolean,
  ): Promise<void> => {
    setProgressName(name)
    setProgressVerb(isInstalled ? "Updating" : "Installing")
    setInstallLog("")
    setInstallDone(false)
    setInstalling(true)

    window.api.removeInstallOutputListener()
    window.api.onInstallOutput((data) => {
      if (!mounted.current) return
      setInstallLog((prev) => prev + data)
      scrollLog()
    })

    try {
      await window.api.installAgentTypeStreaming(name)
      if (mounted.current) {
        setInstallLog(
          (prev) =>
            prev +
            `\n✓ ${name} ${isInstalled ? "updated" : "installed"} successfully.\n`,
        )
        showToast(
          `${name} ${isInstalled ? "updated" : "installed"} successfully`,
          "success",
        )
        scrollLog()
      }
    } catch (err: unknown) {
      if (mounted.current) {
        setInstallLog((prev) => prev + `\n✗ Error: ${(err as Error).message}\n`)
        showToast(
          `${isInstalled ? "Update" : "Install"} failed: ${(err as Error).message}`,
          "error",
        )
      }
    } finally {
      window.api.removeInstallOutputListener()
      if (mounted.current) setInstallDone(true)
    }
  }

  const startUninstall = async (name: string): Promise<void> => {
    setProgressName(name)
    setProgressVerb("Uninstalling")
    setInstallLog("")
    setInstallDone(false)
    setInstalling(true)

    window.api.removeInstallOutputListener()
    window.api.onInstallOutput((data) => {
      if (!mounted.current) return
      setInstallLog((prev) => prev + data)
      scrollLog()
    })

    try {
      await window.api.uninstallAgentTypeStreaming(name)
      if (mounted.current) {
        setInstallLog(
          (prev) => prev + `\n✓ ${name} uninstalled successfully.\n`,
        )
        showToast(`${name} uninstalled`, "success")
        scrollLog()
      }
    } catch (err: unknown) {
      if (mounted.current) {
        setInstallLog((prev) => prev + `\n✗ Error: ${(err as Error).message}\n`)
        showToast(`Uninstall failed: ${(err as Error).message}`, "error")
      }
    } finally {
      window.api.removeInstallOutputListener()
      if (mounted.current) setInstallDone(true)
    }
  }

  const handleBackFromInstall = (): void => {
    setInstalling(false)
    setInstallTarget(null)
    setUninstallTarget(null)
    loadCatalog()
  }

  const filtered = catalog.filter(
    (c) =>
      !search ||
      `${c.name} ${c.label || ""} ${c.description || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )

  // Install/uninstall progress view
  if (installing) {
    return (
      <section>
        <div className="flex items-center gap-3 mb-5">
          <AgentIcon type={progressName} size={32} />
          <div>
            <h1 className="mb-0.5">
              {progressVerb} {progressName}
            </h1>
            <p className="hint" style={{ margin: 0 }}>
              Full installation log is shown below.
            </p>
          </div>
        </div>
        <pre
          ref={logRef}
          className="log-viewer"
          style={{
            minHeight: 300,
            maxHeight: "calc(100vh - 200px)",
          }}
        >
          {installLog}
        </pre>
        {installDone && (
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={handleBackFromInstall}>
              Back to Install
            </Button>
          </div>
        )}
      </section>
    )
  }

  return (
    <section>
      <h1 className="mb-6">Install</h1>

      <div className="card-legacy">
        <h3>Agent Runtimes</h3>
        <p className="hint">Select a runtime to install or update.</p>
        <div className="catalog-search">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            autoComplete="off"
          />
        </div>
        {loading ? (
          <div className="catalog-list">
            <SkeletonCatalogRow />
            <SkeletonCatalogRow />
            <SkeletonCatalogRow />
          </div>
        ) : filtered.length === 0 ? (
          <p className="hint">
            {catalog.length === 0
              ? "No agent runtimes available."
              : "No results found."}
          </p>
        ) : (
          <div className="catalog-list">
            {filtered.map((c) => {
              const health = healthMap[c.name] || null
              const readiness = formatHealthLabel(health)
              const isInstalled = c.installed
              const isGlobal = c.installed && c.managed === false

              return (
                <div
                  key={c.name}
                  className={`catalog-row ${c.installed ? "installed" : ""}`}
                >
                  <div className="catalog-info">
                    <AgentIcon type={c.name} size={28} />
                    <div className="catalog-text">
                      <span className="catalog-name">{c.label || c.name}</span>
                      {c.description && (
                        <span className="catalog-desc">{c.description}</span>
                      )}
                      <span className="catalog-desc">{readiness}</span>
                      <span className="support-icons">
                        <span
                          className={`support-icon ${c.support?.install ? "on" : "off"}`}
                          title="Install supported"
                        >
                          ⬇
                        </span>
                        <span
                          className={`support-icon ${c.support?.workspace ? "on" : "off"}`}
                          title="Workspace supported"
                        >
                          🌐
                        </span>
                        <span
                          className={`support-icon ${c.support?.collaboration ? "on" : "off"}`}
                          title="Collaboration supported"
                        >
                          🤝
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="catalog-status">
                    {isInstalled ? (
                      isGlobal ? (
                        <span
                          className="badge badge-info"
                          title="Installed outside OpenAgents (system/global)"
                        >
                          global
                        </span>
                      ) : (
                        <span className="badge badge-success">installed</span>
                      )
                    ) : (
                      <span className="badge badge-warning">not installed</span>
                    )}
                  </div>
                  <div className="catalog-actions">
                    <Button
                      size="sm"
                      onClick={() =>
                        setInstallTarget({
                          name: c.name,
                          isInstalled: c.installed,
                        })
                      }
                    >
                      {isInstalled && c.managed !== false ? "Update" : "Install"}
                    </Button>
                    {isInstalled && c.managed !== false && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setUninstallTarget(c.name)}
                      >
                        Uninstall
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal open={!!installTarget} onClose={() => setInstallTarget(null)}>
        <div className="flex flex-col items-center" style={{ padding: "8px 0" }}>
          <AgentIcon type={installTarget?.name || ""} size={40} />
          <ModalTitle style={{ marginTop: 12, textAlign: "center" }}>
            {installTarget?.isInstalled ? "Update" : "Install"} {installTarget?.name}?
          </ModalTitle>
          <p className="hint" style={{ margin: "12px 0 20px", textAlign: "center" }}>
            This will run{" "}
            <code className="inline-code">npm install -g {installTarget?.name}@latest</code>{" "}
            on your system.
          </p>
          <div className="form-actions" style={{ justifyContent: "center", marginTop: 0 }}>
            <Button
              variant="primary"
              onClick={() => {
                if (installTarget) {
                  const t = installTarget
                  setInstallTarget(null)
                  startInstall(t.name, t.isInstalled)
                }
              }}
            >
              {installTarget?.isInstalled ? "Update" : "Install"}
            </Button>
            <Button onClick={() => setInstallTarget(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!uninstallTarget} onClose={() => setUninstallTarget(null)}>
        <div className="flex flex-col items-center" style={{ padding: "8px 0" }}>
          <AgentIcon type={uninstallTarget || ""} size={40} />
          <ModalTitle style={{ marginTop: 12, textAlign: "center" }}>
            Uninstall {uninstallTarget}?
          </ModalTitle>
          <p className="hint" style={{ margin: "12px 0 20px", textAlign: "center" }}>
            This will remove <strong>{uninstallTarget}</strong> from your system.
          </p>
          <div className="form-actions" style={{ justifyContent: "center", marginTop: 0 }}>
            <Button
              variant="destructive"
              onClick={() => {
                if (uninstallTarget) {
                  const t = uninstallTarget
                  setUninstallTarget(null)
                  startUninstall(t)
                }
              }}
            >
              Uninstall
            </Button>
            <Button onClick={() => setUninstallTarget(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
