import * as React from "react"
import { cn } from "../../lib/utils"
import type { ConnectionStatus } from "../../types"

const LABELS: Record<ConnectionStatus, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  expired: "Expired",
  unauthorized: "Unauthorized",
  rate_limited: "Rate limited",
  offline: "Offline",
  error: "Error",
}

const CLASSES: Record<ConnectionStatus, string> = {
  connected: "bg-(--success-bg) text-(--success-text)",
  disconnected: "bg-[#f0f0f0] text-[#888]",
  expired: "bg-(--warning-bg) text-(--warning-text)",
  unauthorized: "bg-(--danger-bg) text-(--danger-text)",
  rate_limited: "bg-(--warning-bg) text-(--warning-text)",
  offline: "bg-[#f0f0f0] text-[#888]",
  error: "bg-(--danger-bg) text-(--danger-text)",
}

const DOT: Record<ConnectionStatus, string> = {
  connected: "bg-(--success)",
  disconnected: "bg-(--text-tertiary)",
  expired: "bg-(--warning)",
  unauthorized: "bg-(--danger)",
  rate_limited: "bg-(--warning)",
  offline: "bg-(--text-tertiary)",
  error: "bg-(--danger)",
}

export function ConnectionStatusBadge({
  status,
  className,
}: {
  status: ConnectionStatus
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium",
        CLASSES[status],
        className,
      )}
    >
      <span className={cn("inline-block w-[6px] h-[6px] rounded-full", DOT[status])} />
      {LABELS[status]}
    </span>
  )
}
