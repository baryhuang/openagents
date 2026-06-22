import React from "react"
import { MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/Button"
import AgentIcon from "../AgentIcon"
import { cn } from "../../lib/utils"
import type { Agent } from "../../types"

type StateKey = "running" | "idle" | "starting" | "error" | "offline"

function stateMeta(state: string): { labelKey: StateKey; bg: string; fg: string; dot: string } {
  if (["online", "running"].includes(state)) {
    return {
      labelKey: "running",
      bg: "rgba(34,197,94,0.10)",
      fg: "var(--success-text)",
      dot: "var(--success)",
    }
  }
  if (state === "idle") {
    return {
      labelKey: "idle",
      bg: "rgba(245,158,11,0.10)",
      fg: "var(--warning-text)",
      dot: "var(--warning)",
    }
  }
  if (state === "starting" || state === "reconnecting") {
    return {
      labelKey: "starting",
      bg: "rgba(245,158,11,0.10)",
      fg: "var(--warning-text)",
      dot: "var(--warning)",
    }
  }
  if (state === "error") {
    return {
      labelKey: "error",
      bg: "rgba(239,68,68,0.10)",
      fg: "var(--danger-text)",
      dot: "var(--danger)",
    }
  }
  return {
    labelKey: "offline",
    bg: "var(--bg-input)",
    fg: "var(--text-tertiary)",
    dot: "var(--text-tertiary)",
  }
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

function lastActiveLabel(agent: Agent, t: TFn): string {
  const candidates = [
    (agent as unknown as { lastActiveAt?: string }).lastActiveAt,
    (agent as unknown as { last_active?: string }).last_active,
    (agent as unknown as { startedAt?: string }).startedAt,
  ].filter((v): v is string => typeof v === "string")
  if (candidates.length === 0) return ""
  const ts = new Date(candidates[0]).getTime()
  if (Number.isNaN(ts)) return ""
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return t("dashboard.agentCard.justNow")
  if (s < 60) return t("dashboard.agentCard.secondsAgo", { count: s })
  if (s < 3600) return t("dashboard.agentCard.minutesAgo", { count: Math.floor(s / 60) })
  if (s < 86400) return t("dashboard.agentCard.hoursAgo", { count: Math.floor(s / 3600) })
  return t("dashboard.agentCard.daysAgo", { count: Math.floor(s / 86400) })
}

interface Props {
  agent: Agent
  isPending: boolean
  todayMessages?: number
  onToggle: () => void
  onOpenChat: () => void
}

export function AgentCard({
  agent,
  isPending,
  todayMessages,
  onToggle,
  onOpenChat,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const isRunning = ["online", "running", "idle"].includes(agent.state)
  const meta = stateMeta(agent.state)
  const isConnected = !!agent.network
  const wsName =
    (agent.networkName && agent.networkName !== agent.network
      ? agent.networkName
      : agent.network) || ""
  const lastActive = lastActiveLabel(agent, t)

  return (
    <div
      className={cn(
        "flex flex-col h-full p-4",
        "bg-(--bg-card) border border-(--border) rounded-(--radius)",
        "transition-all duration-150",
        "hover:shadow-(--shadow-md) hover:border-(--border-hover)",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <AgentIcon type={agent.type} size={36} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-semibold text-(--text-primary) truncate">
              {agent.name}
            </span>
            <span
              className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: meta.bg, color: meta.fg }}
            >
              {t(`dashboard.agentCard.state.${meta.labelKey}`)}
            </span>
          </div>
          <div className="text-[11px] text-(--text-tertiary) mt-0.5 truncate">
            {agent.type}
          </div>
        </div>
      </div>

      <div className="mt-3 text-[12px] flex items-center gap-1.5">
        <span
          className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
          style={{ background: isConnected ? "var(--success)" : "var(--text-tertiary)" }}
        />
        {isConnected ? (
          <span className="text-(--text-secondary) truncate">
            {t("dashboard.agentCard.connectedTo")}{" "}
            <span className="font-medium text-(--text-primary)">{wsName}</span>
          </span>
        ) : (
          <span className="text-(--text-tertiary)">{t("dashboard.agentCard.noWorkspace")}</span>
        )}
      </div>

      {agent.lastError && (
        <div className="mt-2 px-2 py-1.5 bg-(--danger-bg) text-(--danger-text) text-[11px] rounded-sm">
          {agent.lastError}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px] text-(--text-tertiary)">
        {lastActive && <span>{t("dashboard.agentCard.lastActive", { time: lastActive })}</span>}
        {lastActive && todayMessages !== undefined && <span>·</span>}
        {todayMessages !== undefined && (
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {t("dashboard.agentCard.messagesToday", { count: todayMessages })}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-(--border)">
        {isRunning ? (
          <Button size="sm" onClick={onToggle} disabled={isPending}>
            {isPending ? t("dashboard.agentCard.stopping") : t("dashboard.agentCard.stop")}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onToggle} disabled={isPending}>
            {isPending ? t("dashboard.agentCard.starting") : t("dashboard.agentCard.start")}
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={onOpenChat}>
          {t("dashboard.agentCard.openChat")}
        </Button>
      </div>
    </div>
  )
}
