import React from "react"
import { Cpu, MessageSquare, Layers, Download, TrendingUp, TrendingDown } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "../../lib/utils"
import type { Agent, ConnectionRecord, AgentUpdateInfo } from "../../types"

interface Props {
  agents: Agent[]
  workspaceCount: number
  connections: ConnectionRecord[]
  todayMessageCount: number
  yesterdayMessageCount?: number
  installedCount?: number
  pendingUpdateCount?: number
  pendingUpdates?: AgentUpdateInfo[]
  className?: string
  onClickUpdates?: () => void
}

interface CardSpec {
  label: string
  value: number | string
  icon: React.JSX.Element
  iconColor: string
  trend?: {
    direction: "up" | "down" | "neutral"
    text: string
    color: string
  }
  link?: { text: string; onClick: () => void }
}

export function StatsOverview({
  agents,
  workspaceCount,
  connections,
  todayMessageCount,
  yesterdayMessageCount,
  installedCount,
  pendingUpdateCount,
  className,
  onClickUpdates,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  void connections // reserved for future card
  const running = agents.filter((a) =>
    ["online", "running", "idle"].includes(a.state),
  ).length

  // Trends
  const agentDiff = (() => {
    // Heuristic placeholder — not enough historical data to compare. Show empty.
    return null
  })()
  void agentDiff

  const messagesTrend = (() => {
    if (yesterdayMessageCount === undefined || yesterdayMessageCount === 0) return undefined
    const pct = Math.round(
      ((todayMessageCount - yesterdayMessageCount) / yesterdayMessageCount) * 100,
    )
    if (pct === 0) return undefined
    const up = pct > 0
    return {
      direction: up ? ("up" as const) : ("down" as const),
      text: t("dashboard.stats.trendVsAvg", {
        symbol: up ? "▲" : "▼",
        pct: Math.abs(pct),
      }),
      color: up ? "var(--success-text)" : "var(--danger-text)",
    }
  })()

  const cards: CardSpec[] = [
    {
      label: t("dashboard.stats.runningAgents"),
      value: running,
      icon: <Cpu className="w-3.5 h-3.5" />,
      iconColor: "var(--success-text)",
      trend: undefined,
    },
    {
      label: t("dashboard.stats.messagesToday"),
      value: todayMessageCount,
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      iconColor: "var(--accent)",
      trend: messagesTrend,
    },
    {
      label: t("dashboard.stats.activeWorkspaces"),
      value: workspaceCount,
      icon: <Layers className="w-3.5 h-3.5" />,
      iconColor: "var(--accent)",
    },
    {
      label: t("dashboard.stats.installedAgents"),
      value: installedCount ?? agents.length,
      icon: <Download className="w-3.5 h-3.5" />,
      iconColor: "var(--accent)",
      link:
        pendingUpdateCount && pendingUpdateCount > 0
          ? {
              text: t("dashboard.stats.updatesAvailable", { count: pendingUpdateCount }),
              onClick: onClickUpdates || ((): void => {}),
            }
          : undefined,
    },
  ]

  return (
    <div className={cn("grid grid-cols-2 lg:grid-cols-4 gap-3", className)}>
      {cards.map((c) => (
        <div
          key={c.label}
          className="bg-(--bg-card) border border-(--border) rounded-(--radius) px-4 py-3.5"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-(--text-secondary)">
            <span style={{ color: c.iconColor }}>{c.icon}</span>
            <span className="leading-tight">{c.label}</span>
          </div>
          <div className="text-[26px] font-bold text-(--text-primary) leading-tight mt-2">
            {c.value}
          </div>
          {c.trend && (
            <div
              className="flex items-center gap-1 text-[11px] mt-1.5 font-medium"
              style={{ color: c.trend.color }}
            >
              {c.trend.direction === "up" ? (
                <TrendingUp className="w-3 h-3" />
              ) : c.trend.direction === "down" ? (
                <TrendingDown className="w-3 h-3" />
              ) : null}
              <span>{c.trend.text}</span>
            </div>
          )}
          {c.link && (
            <button
              type="button"
              onClick={c.link.onClick}
              className="mt-1.5 text-[11px] text-(--accent) hover:underline bg-transparent border-0 cursor-pointer p-0"
            >
              {c.link.text}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
