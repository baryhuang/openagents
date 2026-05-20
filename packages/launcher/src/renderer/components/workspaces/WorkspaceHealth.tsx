import * as React from "react"
import { cn } from "../../lib/utils"

export type WorkspaceHealthState = "healthy" | "warning" | "disconnected" | "error"

const META: Record<WorkspaceHealthState, { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "badge-success-sm" },
  warning: { label: "Warning", className: "badge-warning-sm" },
  disconnected: { label: "Disconnected", className: "badge-muted-sm" },
  error: { label: "Error", className: "badge-danger-sm" },
}

export function WorkspaceHealth({
  state,
  className,
}: {
  state: WorkspaceHealthState
  className?: string
}): React.JSX.Element {
  const meta = META[state]
  return <span className={cn(meta.className, className)}>{meta.label}</span>
}
