import React from "react"
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

const BUCKET_META: Record<
  Bucket,
  { label: string; color: string; bg: string }
> = {
  healthy: {
    label: "Healthy",
    color: "var(--success-text)",
    bg: "var(--success-bg)",
  },
  busy: { label: "Busy", color: "var(--accent)", bg: "var(--accent-bg)" },
  warning: {
    label: "Warning",
    color: "var(--warning-text)",
    bg: "var(--warning-bg)",
  },
  offline: {
    label: "Offline",
    color: "var(--text-tertiary)",
    bg: "var(--bg-input)",
  },
  error: {
    label: "Error",
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
  const buckets: Record<Bucket, Agent[]> = {
    healthy: [],
    busy: [],
    warning: [],
    offline: [],
    error: [],
  }
  for (const a of agents) buckets[bucket(a)].push(a)

  return (
    <div className="bg-(--bg-card) border border-(--border) rounded-(--radius) px-4 py-3.5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-(--text-primary) m-0">
          Agent health
        </h3>
        <span className="text-[10px] text-(--text-tertiary)">
          {agents.length} agents
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2 mb-3">
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
                {meta.label}
              </div>
            </div>
          )
        })}
      </div>
      {agents.length === 0 ? (
        <div className="text-[11px] text-(--text-tertiary) text-center py-3">
          No agents configured.
        </div>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-1 max-h-[200px] overflow-y-auto">
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
