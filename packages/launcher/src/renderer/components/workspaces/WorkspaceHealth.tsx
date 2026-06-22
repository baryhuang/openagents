import * as React from "react"
import { useTranslation } from "react-i18next"
import { cn } from "../../lib/utils"

export type WorkspaceHealthState = "healthy" | "warning" | "disconnected" | "error"

const META: Record<WorkspaceHealthState, { className: string }> = {
  healthy: { className: "badge-success-sm" },
  warning: { className: "badge-warning-sm" },
  disconnected: { className: "badge-muted-sm" },
  error: { className: "badge-danger-sm" },
}

export function WorkspaceHealth({
  state,
  className,
}: {
  state: WorkspaceHealthState
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const meta = META[state]
  return (
    <span className={cn(meta.className, className)}>
      {t(`workspaces.health.${state}`)}
    </span>
  )
}
