import React from "react"
import { useTranslation } from "react-i18next"
import { Copy, ExternalLink, Trash2, Star, Pencil } from "lucide-react"
import { Badge } from "../ui/Badge"
import { Button } from "../ui/Button"
import StatusDot, { displayState } from "../ui/StatusDot"
import AgentIcon from "../AgentIcon"
import { WorkspaceHealth, type WorkspaceHealthState } from "./WorkspaceHealth"
import {
  WorkspaceRecentActivity,
  workspaceRelativeTime,
} from "./WorkspaceRecentActivity"
import { platformLabel } from "../connections/platforms"
import type { Agent, Workspace } from "../../types"
import { workspaceDisplayHost } from "../../lib/workspace-urls"

export interface WorkspaceCardData {
  ws: Workspace
  agents: Agent[]
  health: WorkspaceHealthState
  lastActiveAt: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  sessionCount: number
  connectedPlatforms: string[]
}

export function WorkspaceCard({
  data,
  pendingNames,
  favorite,
  onToggleFavorite,
  onCopyUrl,
  onOpen,
  onRename,
  onRemove,
  onToggleAgent,
  onOpenAgentLogs,
}: {
  data: WorkspaceCardData
  pendingNames: Set<string>
  favorite: boolean
  onToggleFavorite: () => void
  onCopyUrl: () => void
  onOpen: () => void
  onRename: () => void
  onRemove: () => void
  onToggleAgent: (a: Agent) => void
  onOpenAgentLogs: (a: Agent) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { ws, agents, health, lastActiveAt, lastMessageAt, lastMessagePreview, sessionCount, connectedPlatforms } = data
  const slug = ws.slug || ws.id

  return (
    <div className="flex flex-col bg-(--bg-card) border border-(--border) rounded-(--radius) px-[18px] py-4 mb-3 shadow-sm transition-all duration-200 hover:shadow-md hover:border-(--border-hover)">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={onToggleFavorite}
              title={favorite ? t("workspaces.card.unfavorite") : t("workspaces.card.favorite")}
              className="bg-transparent border-0 p-0 cursor-pointer leading-none"
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  favorite ? "fill-(--warning) text-(--warning)" : "text-(--text-tertiary)"
                }`}
              />
            </button>
            <span className="font-semibold text-[14px] tracking-tight truncate">
              {ws.name || slug}
            </span>
            <WorkspaceHealth state={health} />
          </div>
          <div className="text-[11px] text-(--text-tertiary) truncate">
            {workspaceDisplayHost(ws.endpoint)}/{slug}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="icon" variant="ghost" onClick={onCopyUrl} title={t("workspaces.card.copyUrl")}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onOpen} title={t("workspaces.card.openInBrowser")}>
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onRename} title={t("workspaces.card.rename")}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onRemove} title={t("workspaces.card.remove")}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3 text-[11px]">
        <div>
          <div className="text-(--text-tertiary) text-[10px] uppercase tracking-wider mb-0.5">
            {t("workspaces.card.agents")}
          </div>
          <div className="text-(--text-primary) font-semibold">{agents.length}</div>
        </div>
        <div>
          <div className="text-(--text-tertiary) text-[10px] uppercase tracking-wider mb-0.5">
            {t("workspaces.card.lastActive")}
          </div>
          <div className="text-(--text-primary)">{workspaceRelativeTime(lastActiveAt, t)}</div>
        </div>
        <div>
          <div className="text-(--text-tertiary) text-[10px] uppercase tracking-wider mb-0.5">
            {t("workspaces.card.platforms")}
          </div>
          <div className="text-(--text-primary)">
            {connectedPlatforms.length > 0
              ? t("workspaces.card.platformsLinked", { count: connectedPlatforms.length })
              : t("workspaces.card.platformsNone")}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <WorkspaceRecentActivity
          lastMessageAt={lastMessageAt}
          lastMessagePreview={lastMessagePreview}
          sessionCount={sessionCount}
        />
      </div>

      {connectedPlatforms.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {connectedPlatforms.map((p) => (
            <Badge key={p} variant="info" className="!text-[9px] !py-[1px] !px-[6px]">
              {platformLabel(p)}
            </Badge>
          ))}
        </div>
      )}

      {agents.length > 0 ? (
        <div className="border-t border-(--border) pt-3 flex flex-col gap-1.5">
          {agents.map((a) => {
            const isRunning = ["online", "running", "idle"].includes(a.state)
            const isPending = pendingNames.has(a.name)
            return (
              <div
                key={a.name}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-(--bg-input) transition-colors"
              >
                <AgentIcon type={a.type} size={18} />
                <span className="text-[12px] font-medium truncate flex-1 min-w-0">
                  {a.name}
                </span>
                <StatusDot state={a.state} />
                <span className="text-[10px] text-(--text-tertiary) capitalize">
                  {displayState(a.state)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="!text-[10px] !px-2 !py-0.5"
                  onClick={() => onOpenAgentLogs(a)}
                  title={t("workspaces.card.viewLogs")}
                >
                  {t("workspaces.card.logs")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="!text-[10px] !px-2 !py-0.5"
                  onClick={() => onToggleAgent(a)}
                  disabled={isPending}
                >
                  {isPending
                    ? t("workspaces.card.pending")
                    : isRunning
                      ? t("workspaces.card.stop")
                      : t("workspaces.card.start")}
                </Button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-[11px] text-(--text-tertiary) text-center py-3 border-t border-(--border)">
          {t("workspaces.card.noAgents")}
        </div>
      )}
    </div>
  )
}
