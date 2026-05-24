import React from "react"
import {
  Play,
  Square,
  MessageSquare,
  Plus,
  FolderPlus,
  Plug,
} from "lucide-react"
import { Button } from "../ui/Button"

interface Props {
  onStartAll: () => void
  onStopAll: () => void
  onOpenChat: () => void
  onNewWorkspace: () => void
  onAddConnection: () => void
  onNewAgent: () => void
  hasRunning: boolean
  hasIdle: boolean
}

export function QuickActions({
  onStartAll,
  onStopAll,
  onOpenChat,
  onNewWorkspace,
  onAddConnection,
  onNewAgent,
  hasRunning,
  hasIdle,
}: Props): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button size="sm" onClick={onStartAll} disabled={!hasIdle}>
        <Play className="w-3 h-3" />
        Start all
      </Button>
      <Button size="sm" onClick={onStopAll} disabled={!hasRunning}>
        <Square className="w-3 h-3" />
        Stop all
      </Button>
      <Button size="sm" onClick={onOpenChat}>
        <MessageSquare className="w-3 h-3" />
        Open chat
      </Button>
      <Button size="sm" onClick={onNewWorkspace}>
        <FolderPlus className="w-3 h-3" />
        New workspace
      </Button>
      <Button size="sm" onClick={onAddConnection}>
        <Plug className="w-3 h-3" />
        Add connection
      </Button>
      <Button size="sm" variant="primary" onClick={onNewAgent}>
        <Plus className="w-3 h-3" />
        New agent
      </Button>
    </div>
  )
}
