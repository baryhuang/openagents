import React, { useEffect, useRef, useCallback, useState } from "react"
import { useAgentsStore } from "../store/agents"
import { useUiStore } from "../store/ui"
import { useShallow } from "zustand/react/shallow"
import AgentIcon from "../components/AgentIcon"
import StatusDot, { displayState } from "../components/ui/StatusDot"
import { Button } from "../components/ui/Button"
import type { Agent, HealthCheck } from "../types"
import type { ToastType } from "../hooks/useToast"

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
    <div className="agent-card">
      <div className="agent-card-header">
        <AgentIcon type={agent.type} size={24} />
        <span className="agent-card-name">{agent.name}</span>
        <span className="agent-card-type">{agent.type}</span>
      </div>
      <div className="agent-card-status">
        <StatusDot state={agent.state} />
        <span>{displayState(agent.state)}</span>
      </div>
      <div className="agent-card-info">
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
        <div className="agent-card-error">{agent.lastError}</div>
      )}
      <div className="agent-card-actions">
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
    <div className="agent-card">
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
  const { activityLog, setCurrentTab } = useUiStore(useShallow((s) => ({ activityLog: s.activityLog, setCurrentTab: s.setCurrentTab })))

  const inFlight = useRef(false)
  const queued = useRef(false)
  const mounted = useRef(true)
  const [loading, setLoading] = useState(agents.length === 0)

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
      <div className="card-legacy" style={{ marginTop: 20 }}>
        <h3>Activity</h3>
        <div className="activity-log">
          {activityLog.length === 0 ? (
            <span className="hint" style={{ marginBottom: 0 }}>
              No activity yet. Start an agent to see events.
            </span>
          ) : (
            activityLog.map((entry, i) => (
              <div key={i} className="activity-log-entry">
                <span className="activity-log-time">{entry.time}</span>
                <span className="activity-log-msg">{entry.msg}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
