import React from "react"
import { useTranslation } from "react-i18next"
import type { Agent } from "../../types"
import StatusDot, { displayState } from "../ui/StatusDot"
import { cn } from "../../lib/utils"

type Bucket = "healthy" | "busy" | "warning" | "offline" | "error"

function bucket(a: Agent): Bucket {
  if (a.state === "error" || a.lastError) return "error"
  if (a.state === "starting" || a.state === "reconnecting") return "warning"
  if (["running", "online"].includes(a.state)) return "healthy"
  if (a.state === "idle") return "busy"
  return "offline"
}

const BUCKET_META: Record<Bucket, { color: string; bg: string }> = {
  healthy: {
    color: "var(--success-text)",
    bg: "var(--success-bg)",
  },
  busy: { color: "var(--accent)", bg: "var(--accent-bg)" },
  warning: {
    color: "var(--warning-text)",
    bg: "var(--warning-bg)",
  },
  offline: {
    color: "var(--text-tertiary)",
    bg: "var(--bg-input)",
  },
  error: {
    color: "var(--danger-text)",
    bg: "var(--danger-bg)",
  },
}

export function HealthMonitor({
  agents,
  onSelect,
}: {
  agents: Agent[]
  onSelect?: (name: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const buckets: Record<Bucket, Agent[]> = {
    healthy: [],
    busy: [],
    warning: [],
    offline: [],
    error: [],
  }
  for (const a of agents) buckets[bucket(a)].push(a)

  return (
    <div className="flex flex-col h-full bg-(--bg-card) border border-(--border) rounded-(--radius) px-4 py-3.5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-(--text-primary) m-0">
          {t("dashboard.health.title")}
        </h3>
        <span className="text-[10px] text-(--text-tertiary)">
          {t("dashboard.health.agentCount", { count: agents.length })}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2 mb-3 shrink-0">
        {(Object.keys(BUCKET_META) as Bucket[]).map((b) => {
          const meta = BUCKET_META[b]
          const count = buckets[b].length
          return (
            <div
              key={b}
              className="rounded-(--radius-sm) px-2.5 py-2 text-center"
              style={{ background: meta.bg }}
            >
              <div
                className="text-[18px] font-bold leading-tight"
                style={{ color: meta.color }}
              >
                {count}
              </div>
              <div
                className="text-[10px] mt-0.5"
                style={{ color: meta.color }}
              >
                {t(`dashboard.health.buckets.${b}`)}
              </div>
            </div>
          )
        })}
      </div>
      {agents.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-(--text-tertiary) text-center py-3">
          {t("dashboard.health.empty")}
        </div>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
          {agents.map((a) => (
            <li
              key={a.name}
              onClick={() => onSelect?.(a.name)}
              className={cn(
                "flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm cursor-pointer text-[12px]",
                "hover:bg-(--bg-input)",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <StatusDot state={a.state} />
                <span className="truncate">{a.name}</span>
                <span className="text-[10px] text-(--text-tertiary) shrink-0">
                  {a.type}
                </span>
              </div>
              <span className="text-[10px] text-(--text-tertiary) shrink-0">
                {displayState(a.state)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
