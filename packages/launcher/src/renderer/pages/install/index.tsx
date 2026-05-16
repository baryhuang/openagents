import React, { useEffect, useMemo, useState, useCallback } from "react"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { Badge } from "../../components/ui/Badge"
import { Modal, ModalTitle } from "../../components/ui/Modal"
import AgentIcon from "../../components/AgentIcon"
import AgentDetail from "../agents/AgentDetail"
import SetupWizard from "../../components/SetupWizard"
import { cn } from "../../lib/utils"
import { useInstallStore, hasPendingUpdate, type InstallJob } from "../../store/install"
import { useUiStore } from "../../store/ui"
import type { CatalogEntry, AgentUpdateInfo, InstalledAgentRecord } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface InstallProps {
  showToast: (msg: string, type?: ToastType) => void
}

interface ActionBarProps {
  entry: CatalogEntry
  job: InstallJob | undefined
  hasUpdate: boolean
  size?: "sm" | "default"
  className?: string
  onInstall: (entry: CatalogEntry, verb: "install" | "update") => void
  onUninstall: (entry: CatalogEntry) => void
}

function AgentActions({
  entry,
  job,
  hasUpdate,
  size = "sm",
  className,
  onInstall,
  onUninstall,
}: ActionBarProps): React.JSX.Element | null {
  const stop = (e: React.MouseEvent): void => e.stopPropagation()
  const isInstalled = entry.installed
  const isManaged = entry.managed !== false
  const busy = !!job && job.phase !== "done" && job.phase !== "error"
  const wrapperClass = cn("shrink-0 flex gap-1.5", className)

  if (busy && job) {
    const verb = job.verb === "uninstall" ? "Uninstalling…" : job.verb === "rollback" ? "Rolling back…" : job.verb === "update" ? "Updating…" : "Installing…"
    return (
      <div className={wrapperClass} onClick={stop}>
        <Button size={size} disabled>{verb}</Button>
      </div>
    )
  }

  // Globally installed (not managed by launcher) — no actions available.
  if (isInstalled && !isManaged) return null

  return (
    <div className={wrapperClass} onClick={stop}>
      {!isInstalled ? (
        <Button
          size={size}
          variant="primary"
          onClick={(e) => { e.stopPropagation(); onInstall(entry, "install") }}
        >Install</Button>
      ) : (
        <>
          {hasUpdate && (
            <Button
              size={size}
              variant="primary"
              onClick={(e) => { e.stopPropagation(); onInstall(entry, "update") }}
            >Update</Button>
          )}
          <Button
            size={size}
            variant="destructive"
            onClick={(e) => { e.stopPropagation(); onUninstall(entry) }}
          >Uninstall</Button>
        </>
      )}
    </div>
  )
}

function SupportIcons({ support }: { support?: CatalogEntry["support"] }): React.JSX.Element {
  const items: Array<{ key: string; icon: string; title: string; on: boolean }> = [
    { key: "install", icon: "⬇", title: "Install supported", on: !!support?.install },
    { key: "workspace", icon: "🌐", title: "Workspace supported", on: !!support?.workspace },
    { key: "collaboration", icon: "🤝", title: "Collaboration supported", on: !!support?.collaboration },
  ]
  return (
    <span className="inline-flex gap-1 mt-0.5">
      {items.map((it) => (
        <span
          key={it.key}
          className={cn("text-[11px] leading-none", it.on ? "opacity-100" : "opacity-20")}
          title={it.title}
        >{it.icon}</span>
      ))}
    </span>
  )
}

type SortKey = "featured" | "newest" | "popular"
type ViewMode = "grid" | "list"

const CATEGORIES: Array<{ key: string; label: string; match: (e: CatalogEntry) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "coding", label: "Coding", match: (e) => (e.tags || []).includes("coding") },
  { key: "open-source", label: "Open source", match: (e) => (e.tags || []).includes("open-source") },
  { key: "cli", label: "CLI", match: (e) => (e.tags || []).includes("cli") },
  { key: "ide-extension", label: "IDE extension", match: (e) => (e.tags || []).some((t) => t === "vscode" || t === "editor" || t === "ide-extension") },
]

const CATALOG_CARD = "flex flex-col gap-2.5 min-h-[158px] px-[18px] py-4 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm cursor-pointer transition-all duration-200 hover:shadow-md hover:border-(--border-hover) hover:-translate-y-px"

const CATALOG_ROW = "flex items-center gap-3.5 px-4 py-3 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm transition-all duration-150 hover:shadow-md hover:border-(--border-hover) cursor-pointer"

const TAG = "text-[10px] px-[7px] py-0.5 rounded-[10px] bg-(--bg-input) text-(--text-secondary)"
const TAG_UPDATE = "text-[10px] px-[7px] py-0.5 rounded-[10px] bg-(--warning-bg) text-(--warning-text)"

function SkeletonCard(): React.JSX.Element {
  return (
    <div className={CATALOG_CARD}>
      <div className="skeleton-shimmer rounded-full h-3 w-[60%] mb-2" />
      <div className="skeleton-shimmer rounded-full h-2 w-[80%]" />
      <div className="skeleton-shimmer rounded-full h-2 w-[40%]" />
    </div>
  )
}

export default function Install({ showToast }: InstallProps): React.JSX.Element {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string>("all")
  const [sort, setSort] = useState<SortKey>("featured")
  const [view, setView] = useState<ViewMode>("grid")
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [wizardEntry, setWizardEntry] = useState<CatalogEntry | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<CatalogEntry | null>(null)
  const setInstalled = useInstallStore((s) => s.setInstalled)
  const setUpdates = useInstallStore((s) => s.setUpdates)
  const updates = useInstallStore((s) => s.updates)
  const installedList = useInstallStore((s) => s.installed)
  const jobs = useInstallStore((s) => s.jobs)
  const installFocusAgent = useUiStore((s) => s.installFocusAgent)
  const setInstallFocusAgent = useUiStore((s) => s.setInstallFocusAgent)
  const installListSignal = useUiStore((s) => s.installListSignal)

  // Deep-link: when triggered via tray menu or Dashboard banner, open the
  // detail view for the requested agent and clear the request flag.
  useEffect(() => {
    if (installFocusAgent) {
      setSelectedName(installFocusAgent)
      setInstallFocusAgent(null)
    }
  }, [installFocusAgent, setInstallFocusAgent])

  // Clicking the Install sidebar tab bumps installListSignal — always return
  // to the marketplace list rather than resuming the previous detail view.
  useEffect(() => {
    if (installListSignal > 0) setSelectedName(null)
  }, [installListSignal])

  const handleInlineInstall = useCallback(async (entry: CatalogEntry, verb: "install" | "update"): Promise<void> => {
    // Route into the detail page first so the user sees full context
    // (progress card, configuration, log) instead of just a card-level spinner.
    setSelectedName(entry.name)
    const wasInstalled = installedList.some((r) => r.name === entry.name)
    useInstallStore.getState().startJob({ agent: entry.name, verb })
    try {
      await window.api.installAgentTypeStreaming(entry.name)
      showToast(`${entry.label || entry.name} ${verb === "update" ? "updated" : "installed"}`, "success")
      if (!wasInstalled && verb === "install") setWizardEntry(entry)
    } catch (e: unknown) {
      showToast(`${verb} failed: ${(e as Error).message}`, "error")
    }
  }, [showToast, installedList])

  const handleInlineUninstall = useCallback((entry: CatalogEntry): void => {
    setUninstallTarget(entry)
  }, [])

  const confirmUninstall = useCallback(async (): Promise<void> => {
    const entry = uninstallTarget
    if (!entry) return
    setUninstallTarget(null)
    useInstallStore.getState().startJob({ agent: entry.name, verb: "uninstall" })
    try {
      await window.api.uninstallAgentTypeStreaming(entry.name)
      showToast(`${entry.label || entry.name} uninstalled`, "success")
    } catch (e: unknown) {
      showToast(`Uninstall failed: ${(e as Error).message}`, "error")
    }
  }, [uninstallTarget, showToast])

  const loadAll = useCallback(async () => {
    try {
      const [cat, inst, upd] = await Promise.all([
        window.api.getCatalog(),
        window.api.getInstalledAgents().catch(() => [] as InstalledAgentRecord[]),
        window.api.checkAgentUpdates().catch(() => [] as AgentUpdateInfo[]),
      ])
      setCatalog(cat)
      setInstalled(inst)
      setUpdates(upd)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [setInstalled, setUpdates])

  // Refresh catalog when a job reaches a terminal state.
  useEffect(() => {
    const finished = Object.values(jobs).filter((j) => j.phase === "done" || j.phase === "error")
    if (finished.length > 0) {
      loadAll()
    }
  }, [jobs, loadAll])

  useEffect(() => {
    loadAll()
    const id = setInterval(loadAll, 30000)
    return () => clearInterval(id)
  }, [loadAll])

  const filteredSorted = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.key === category) || CATEGORIES[0]
    const lowerSearch = search.toLowerCase()
    const filtered = catalog.filter((c) => {
      if (!cat.match(c)) return false
      if (!search) return true
      return `${c.name} ${c.label || ""} ${c.description || ""} ${(c.tags || []).join(" ")}`
        .toLowerCase().includes(lowerSearch)
    })

    if (sort === "featured") {
      filtered.sort((a, b) => {
        const af = a.featured ? 1 : 0
        const bf = b.featured ? 1 : 0
        if (af !== bf) return bf - af
        const ao = typeof a.order === "number" ? a.order : 999
        const bo = typeof b.order === "number" ? b.order : 999
        if (ao !== bo) return ao - bo
        return (a.label || a.name).localeCompare(b.label || b.name)
      })
    } else if (sort === "newest") {
      filtered.sort((a, b) => {
        const ar = installedList.find((r) => r.name === a.name)?.installedAt || ""
        const br = installedList.find((r) => r.name === b.name)?.installedAt || ""
        if (ar !== br) return br.localeCompare(ar)
        return (a.label || a.name).localeCompare(b.label || b.name)
      })
    } else if (sort === "popular") {
      filtered.sort((a, b) => {
        const ai = a.installed ? 1 : 0
        const bi = b.installed ? 1 : 0
        if (ai !== bi) return bi - ai
        return (a.label || a.name).localeCompare(b.label || b.name)
      })
    }
    return filtered
  }, [catalog, category, search, sort, installedList])

  const selected = selectedName ? catalog.find((c) => c.name === selectedName) : null
  if (selected) {
    return (
      <>
        <AgentDetail
          entry={selected}
          onBack={() => setSelectedName(null)}
          onAfterInstall={(e) => {
            loadAll()
            if (!installedList.find((r) => r.name === e.name)) {
              // Newly installed — open the wizard
              setWizardEntry(e)
            }
          }}
          onOpenWizard={(e) => setWizardEntry(e)}
          showToast={showToast}
        />
        <SetupWizard entry={wizardEntry} open={!!wizardEntry} onClose={() => setWizardEntry(null)} showToast={showToast} />
      </>
    )
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="m-0">Agent Marketplace</h1>
        <span className="hint m-0">
          {catalog.length} agents · {installedList.length} installed
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mb-3.5 [&>*]:shrink-0">
        <div className="flex-1 min-w-[180px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents, tags, descriptions…"
          />
        </div>
        <select
          className="bg-(--bg-input) text-(--text-primary) px-3 py-1.75 text-xs rounded-sm border-0 outline-none"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          <option value="featured">Sort: Featured</option>
          <option value="popular">Sort: Popular</option>
          <option value="newest">Sort: Newest</option>
        </select>
        <div className="flex rounded-sm overflow-hidden border border-(--border)">
          <button
            type="button"
            onClick={() => setView("grid")}
            className={cn(
              "px-3 py-1.5 text-[11px] cursor-pointer",
              view === "grid" ? "bg-(--accent) text-white" : "bg-(--bg-card) text-(--text-secondary)",
            )}
            title="Grid view"
          >Grid</button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "px-3 py-1.5 text-[11px] cursor-pointer",
              view === "list" ? "bg-(--accent) text-white" : "bg-(--bg-card) text-(--text-secondary)",
            )}
            title="List view"
          >List</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded-full border cursor-pointer transition-colors duration-150",
              category === c.key
                ? "bg-(--accent) text-(--accent-text) border-(--accent)"
                : "bg-(--bg-card) text-(--text-secondary) border-(--border) hover:border-(--border-hover) hover:text-(--text-primary)",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1920px]:grid-cols-6 min-[2400px]:grid-cols-7 min-[2880px]:grid-cols-8 gap-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : filteredSorted.length === 0 ? (
        <p className="hint">No agents match the current filters.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1920px]:grid-cols-6 min-[2400px]:grid-cols-7 min-[2880px]:grid-cols-8 gap-3">
          {filteredSorted.map((c) => {
            const hasUpdate = hasPendingUpdate(updates, c.name)
            const job = jobs[c.name]
            return (
              <div
                key={c.name}
                className={CATALOG_CARD}
                onClick={() => setSelectedName(c.name)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") setSelectedName(c.name) }}
              >
                <div className="flex items-center gap-2.5">
                  <AgentIcon type={c.name} size={32} />
                  <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-(--text-primary)">{c.label || c.name}</div>
                  {c.featured && <span className="text-[11px] text-(--accent)" title="Featured">★</span>}
                </div>
                <div className="text-[11.5px] text-(--text-secondary) leading-snug line-clamp-2 overflow-hidden">{c.description || "No description."}</div>
                <div className="flex flex-wrap gap-1">
                  {(c.tags || []).slice(0, 3).map((t) => (
                    <span key={t} className={TAG}>{t}</span>
                  ))}
                </div>
                <SupportIcons support={c.support} />
                <div className="flex items-center justify-between mt-auto text-[11px]">
                  <div className="flex items-center gap-1.5">
                    {c.installed ? (
                      c.managed === false
                        ? <Badge variant="info">Global</Badge>
                        : <Badge variant="success">Installed</Badge>
                    ) : (
                      <span className="text-(--text-tertiary)">Not installed</span>
                    )}
                    {hasUpdate && <span className={TAG_UPDATE}>Update</span>}
                  </div>
                </div>
                <AgentActions
                  entry={c}
                  job={job}
                  hasUpdate={hasUpdate}
                  size="sm"
                  className="flex-wrap border-t border-(--border) pt-2.5 mt-0.5 [&>button]:flex-1 [&>button]:min-w-0"
                  onInstall={handleInlineInstall}
                  onUninstall={handleInlineUninstall}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredSorted.map((c) => {
            const hasUpdate = hasPendingUpdate(updates, c.name)
            const job = jobs[c.name]
            return (
              <div
                key={c.name}
                className={CATALOG_ROW}
                onClick={() => setSelectedName(c.name)}
                role="button"
                tabIndex={0}
              >
                <div className="flex-1 min-w-0 flex items-center gap-3.5">
                  <AgentIcon type={c.name} size={28} />
                  <div className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-(--text-primary)">
                      {c.label || c.name}{" "}
                      {c.featured && <span className="text-[11px] text-(--accent)">★</span>}
                    </span>
                    {c.description && <span className="block mt-px text-[11px] text-(--text-tertiary)">{c.description}</span>}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(c.tags || []).slice(0, 4).map((t) => (
                        <span key={t} className={TAG}>{t}</span>
                      ))}
                    </div>
                    <SupportIcons support={c.support} />
                  </div>
                </div>
                <div className="shrink-0">
                  {c.installed ? (
                    c.managed === false
                      ? <Badge variant="info">Global</Badge>
                      : <Badge variant="success">Installed</Badge>
                  ) : (
                    <Badge variant="warning">Not installed</Badge>
                  )}
                  {hasUpdate && <span className={TAG_UPDATE}>Update</span>}
                </div>
                <AgentActions
                  entry={c}
                  job={job}
                  hasUpdate={hasUpdate}
                  size="sm"
                  onInstall={handleInlineInstall}
                  onUninstall={handleInlineUninstall}
                />
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!uninstallTarget} onClose={() => setUninstallTarget(null)}>
        <div className="flex flex-col items-center" style={{ padding: "8px 0" }}>
          <AgentIcon type={uninstallTarget?.name || ""} size={40} />
          <ModalTitle style={{ marginTop: 12, textAlign: "center" }}>
            Uninstall {uninstallTarget?.label || uninstallTarget?.name}?
          </ModalTitle>
          <p className="hint" style={{ margin: "12px 0 20px", textAlign: "center" }}>
            This will remove <strong>{uninstallTarget?.label || uninstallTarget?.name}</strong> from your system. Configured agents of this type may stop working.
          </p>
          <div className="form-actions" style={{ justifyContent: "center", marginTop: 0 }}>
            <Button variant="destructive" onClick={confirmUninstall}>
              Uninstall
            </Button>
            <Button onClick={() => setUninstallTarget(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
