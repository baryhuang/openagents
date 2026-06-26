import React from "react"
import { Play, Square, Plus, FolderPlus, Plug } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/Button"

interface Props {
  onStartAll: () => void
  onStopAll: () => void
  onNewWorkspace: () => void
  onAddConnection: () => void
  onNewAgent: () => void
  hasRunning: boolean
  hasIdle: boolean
}

export function QuickActions({
  onStartAll,
  onStopAll,
  onNewWorkspace,
  onAddConnection,
  onNewAgent,
  hasRunning,
  hasIdle,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button size="sm" onClick={onStartAll} disabled={!hasIdle}>
        <Play className="w-3 h-3" />
        {t("dashboard.quickActions.startAll")}
      </Button>
      <Button size="sm" onClick={onStopAll} disabled={!hasRunning}>
        <Square className="w-3 h-3" />
        {t("dashboard.quickActions.stopAll")}
      </Button>
      <Button size="sm" onClick={onNewWorkspace}>
        <FolderPlus className="w-3 h-3" />
        {t("dashboard.quickActions.newWorkspace")}
      </Button>
      <Button size="sm" onClick={onAddConnection}>
        <Plug className="w-3 h-3" />
        {t("dashboard.quickActions.addConnection")}
      </Button>
      <Button size="sm" variant="primary" onClick={onNewAgent}>
        <Plus className="w-3 h-3" />
        {t("dashboard.quickActions.newAgent")}
      </Button>
    </div>
  )
}
