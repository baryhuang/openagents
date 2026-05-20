import React, { useEffect, useRef, useCallback, useState } from "react"
import { useAgentsStore } from "../../store/agents"
import { useUiStore } from "../../store/ui"
import { useInstallStore } from "../../store/install"
import { useShallow } from "zustand/react/shallow"
import AgentIcon from "../../components/AgentIcon"
import StatusDot, { displayState } from "../../components/ui/StatusDot"
import { Button } from "../../components/ui/Button"
import type { Agent, HealthCheck, AgentUpdateInfo } from "../../types"
import { useUpdateDismissals } from "../../hooks/useUpdateDismissals"
import type { ToastType } from "../../hooks/useToast"

interface DashboardProps {
  showToast: (message: string, type?: ToastType) => void
  onOpenConfigure: (agentName: string, agentType: string) => void
  onOpenConnectWorkspace: (agentName: string) => void
}

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

const CARD_BASE = "flex flex-col h-full bg-(--bg-card) border border-(--border) rounded-(--radius) px-[18px] py-4 shadow-sm transition-all duration-200 hover:shadow-md hover:border-(--border-hover)"

function AgentCard({
  agent,
  isPending,
  onToggle,
  onOpenWorkspace,
}: {
  agent: Agent
  isPending: boolean
  onToggle: () => void
  onOpenWorkspace: () => void
}): React.JSX.Element {
  const isRunning = ["online", "running", "idle"].includes(agent.state)
  const health = agent.health || null
  const isConnected = !!agent.network
  const isUnsupported = !!agent.runtimeMismatch
  const wsLabel = agent.network
    ? agent.networkName && agent.networkName !== agent.network
      ? `${agent.network} (${agent.networkName})`
      : agent.network
    : ""
  const configLabel = formatHealthLabel(health)

  return (
    <div className={CARD_BASE}>
      <div className="flex justify-between items-center mb-2 gap-3">
        <AgentIcon type={agent.type} size={24} />
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold tracking-tight">{agent.name}</span>
        <span className="shrink-0 bg-(--bg-input) text-(--text-tertiary) text-[11px] font-medium px-2.5 py-0.5 rounded-full">{agent.type}</span>
      </div>
      <div className="flex items-center gap-1.5 mb-3 text-xs text-(--text-secondary)">
        <StatusDot state={agent.state} />
        <span>{displayState(agent.state)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 my-1.5 flex-1 content-start">
        {isUnsupported ? (
          <span className="badge-danger-sm">Launcher core update required</span>
        ) : health?.ready ? (
          <span className="badge-success-sm">{configLabel}</span>
        ) : (
          <span className="badge-warning-sm">{configLabel}</span>
        )}
        {isConnected ? (
          <span className="badge-success-sm">Connected: {wsLabel}</span>
        ) : (
          <span className="badge-muted-sm">Not connected</span>
        )}
      </div>
      {agent.lastError && (
        <div className="mb-2.5 px-3 py-2 bg-(--danger-bg) text-(--danger-text) text-[11px] rounded-sm leading-snug">{agent.lastError}</div>
      )}
      <div className="flex gap-2 flex-wrap mt-auto pt-2">
        {isRunning ? (
          <>
            <Button size="sm" onClick={onToggle} disabled={isPending}>
              {isPending ? "Stopping..." : "Stop"}
            </Button>
            {isConnected && (
              <Button size="sm" variant="primary" onClick={onOpenWorkspace}>
                Open Workspace
              </Button>
            )}
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={onToggle}
            disabled={isPending}
          >
            {isPending ? "Starting..." : "Start"}
          </Button>
        )}
      </div>
    </div>
  )
}

function SkeletonCard(): React.JSX.Element {
  return (
    <div className={CARD_BASE}>
      <div className="skeleton-shimmer rounded-full h-2.5 w-[62%] mb-2.5" />
      <div className="skeleton-shimmer rounded-full h-2.5 w-[42%] mb-2.5" />
      <div className="skeleton-shimmer rounded-full h-2.5 w-[26%]" />
    </div>
  )
}

export default function Dashboard({
  showToast,
}: DashboardProps): React.JSX.Element {
  const { agents, setAgents, pendingAgentActions, addPendingAction, removePendingAction, setCoreVersion, setLauncherVersion } =
    useAgentsStore(useShallow((s) => ({
      agents: s.agents, setAgents: s.setAgents,
      pendingAgentActions: s.pendingAgentActions,
      addPendingAction: s.addPendingAction, removePendingAction: s.removePendingAction,
      setCoreVersion: s.setCoreVersion, setLauncherVersion: s.setLauncherVersion,
    })))
  const { activityLog, setCurrentTab, setInstallFocusAgent } = useUiStore(useShallow((s) => ({ activityLog: s.activityLog, setCurrentTab: s.setCurrentTab, setInstallFocusAgent: s.setInstallFocusAgent })))
  const { updates, setUpdates } = useInstallStore(useShallow((s) => ({ updates: s.updates, setUpdates: s.setUpdates })))
  const { isDismissed, ignore: ignoreUpdate, later: snoozeUpdate } = useUpdateDismissals()

  const inFlight = useRef(false)
  const queued = useRef(false)
  const mounted = useRef(true)
  const [loading, setLoading] = useState(agents.length === 0)
  const pendingUpdates = updates.filter(
    (u: AgentUpdateInfo) =>
      u.current &&
      u.latest &&
      u.current !== u.latest &&
      !isDismissed(u.name, u.latest),
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true
      return
    }
    inFlight.current = true
    try {
      const data = await window.api.listAgents()
      if (!mounted.current) return
      setAgents(data)
      setLoading(false)

      const status = await window.api.pythonStatus()
      if (!mounted.current) return
      setCoreVersion(status.sdkVersion)
      setLauncherVersion(`v${status.launcherVersion}`)
    } catch (err) {
      console.error("Dashboard refresh error:", err)
    } finally {
      inFlight.current = false
      if (queued.current) {
        queued.current = false
        refresh()
      }
    }
  }, [setAgents, setCoreVersion, setLauncherVersion])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const u = await window.api.checkAgentUpdates()
        if (!cancelled) setUpdates(u)
      } catch {}
    }
    load()
    const id = setInterval(load, 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [setUpdates])

  const toggleAgent = async (agent: Agent): Promise<void> => {
    if (pendingAgentActions.has(agent.name)) return
    addPendingAction(agent.name)
    refresh()
    try {
      const isRunning = ["online", "running", "idle"].includes(agent.state)
      if (isRunning) {
        await window.api.stopAgent(agent.name)
        showToast(`Stopping ${agent.name}...`, "info")
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 3000))
          const status = await window.api.agentStatus()
          const a = status[agent.name]
          if (!a || a.state === "stopped") {
            showToast(`${agent.name} stopped`, "success")
            break
          }
          refresh()
        }
      } else {
        await window.api.startAgent(agent.name)
        showToast(`Starting ${agent.name}...`, "info")
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 3000))
          const status = await window.api.agentStatus()
          const a = status[agent.name]
          if (a && ["running", "online"].includes(a.state)) {
            showToast(`${agent.name} is now running`, "success")
            break
          }
          refresh()
        }
      }
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      removePendingAction(agent.name)
      refresh()
    }
  }

  const openWorkspaceInBrowser = async (agent: Agent): Promise<void> => {
    try {
      const workspaces = await window.api.listWorkspaces()
      const ws = workspaces.find(
        (w) => w.slug === agent.network || w.id === agent.network,
      )
      const slug = (ws && ws.slug) || agent.network
      let url = `https://workspace.openagents.org/${slug}`
      if (ws && ws.token) url += `?token=${encodeURIComponent(ws.token)}`
      window.api.openExternal(url)
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  return (
    <section>
      <h1 className="mb-6">Dashboard</h1>

      {pendingUpdates.length > 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 text-xs bg-(--accent-bg) border border-(--accent-border) rounded-(--radius)">
          <span className="text-lg">↑</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-(--text-primary)">
              {pendingUpdates.length === 1
                ? `Update available for ${pendingUpdates[0].name}`
                : `${pendingUpdates.length} agent updates available`}
            </div>
            <div className="text-(--text-secondary) truncate">
              {pendingUpdates.slice(0, 3).map((u) => `${u.name} v${u.current} → v${u.latest}`).join(" · ")}
            </div>
          </div>
          {/* Stage.md §2.6 — Ignore / Later / Update Now. Per-update
             dismissal is stored client-side via useUpdateDismissals;
             "Ignore" sticks until the latest pointer moves, "Later"
             snoozes 24h. Only surface Ignore/Later when there's exactly
             one pending update so the buttons map to an unambiguous target. */}
          {pendingUpdates.length === 1 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const u = pendingUpdates[0]
                  if (u.latest) ignoreUpdate(u.name, u.latest)
                }}
              >
                Ignore
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const u = pendingUpdates[0]
                  if (u.latest) snoozeUpdate(u.name, u.latest)
                }}
              >
                Later
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (pendingUpdates.length === 1) {
                setInstallFocusAgent(pendingUpdates[0].name)
              }
              setCurrentTab("install")
            }}
          >
            {pendingUpdates.length === 1 ? "Update now" : "View"}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="card-grid">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : agents.length === 0 ? (
        <div className="card-grid">
          <div className="card-legacy empty-state">
            <p>No agents configured yet.</p>
            <Button onClick={() => setCurrentTab("agents")}>Add Agent</Button>
          </div>
        </div>
      ) : (
        <div className="card-grid">
          {agents.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              isPending={pendingAgentActions.has(agent.name)}
              onToggle={() => toggleAgent(agent)}
              onOpenWorkspace={() => openWorkspaceInBrowser(agent)}
            />
          ))}
        </div>
      )}

      {/* Activity log */}
      <div className="card-legacy mt-5">
        <h3>Activity</h3>
        <div className="max-h-45 overflow-y-auto text-[11.5px] leading-relaxed text-(--text-secondary)">
          {activityLog.length === 0 ? (
            <span className="hint m-0">No activity yet. Start an agent to see events.</span>
          ) : (
            activityLog.map((entry, i) => (
              <div key={i} className="flex gap-2 py-0.5 border-b border-(--border) last:border-b-0">
                <span className="shrink-0 min-w-12.5 text-[10px] text-(--text-tertiary)">{entry.time}</span>
                <span className="flex-1 min-w-0 wrap-break-word">{entry.msg}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
