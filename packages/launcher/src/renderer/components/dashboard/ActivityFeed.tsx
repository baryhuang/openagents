import React from "react"
import {
  Activity,
  AlertOctagon,
  AtSign,
  Bell,
  Github,
  MessageSquare,
} from "lucide-react"
import type { NotifRecord } from "../../types"
import { cn } from "../../lib/utils"

export interface ActivityEntry {
  time: string
  msg: string
}

interface Props {
  /** Renderer-side ephemeral log (toasts, etc) */
  uiActivity: ActivityEntry[]
  /** Persistent notifications from main */
  notifications: NotifRecord[]
}

interface FeedItem {
  id: string
  kind: "ui" | "notif"
  time: string
  title: string
  body?: string
  icon: React.JSX.Element
  tint?: string
}

function notifIcon(kind: NotifRecord["kind"]): {
  icon: React.JSX.Element
  tint?: string
} {
  switch (kind) {
    case "agent_error":
    case "workspace_error":
    case "platform_error":
      return {
        icon: <AlertOctagon className="w-3.5 h-3.5" />,
        tint: "var(--danger-text)",
      }
    case "agent_mention":
    case "workspace_mention":
      return {
        icon: <AtSign className="w-3.5 h-3.5" />,
        tint: "var(--accent)",
      }
    case "workspace_message":
      return {
        icon: <MessageSquare className="w-3.5 h-3.5" />,
        tint: "var(--text-secondary)",
      }
    case "github":
      return {
        icon: <Github className="w-3.5 h-3.5" />,
        tint: "var(--text-secondary)",
      }
    default:
      return {
        icon: <Bell className="w-3.5 h-3.5" />,
        tint: "var(--text-secondary)",
      }
  }
}

function tsLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export function ActivityFeed({
  uiActivity,
  notifications,
}: Props): React.JSX.Element {
  const items: FeedItem[] = []

  for (const n of notifications.slice(0, 50)) {
    const { icon, tint } = notifIcon(n.kind)
    items.push({
      id: `n:${n.id}`,
      kind: "notif",
      time: tsLabel(n.createdAt),
      title: n.title,
      body: n.body,
      icon,
      tint,
    })
  }
  for (let i = 0; i < uiActivity.length; i++) {
    const e = uiActivity[i]
    items.push({
      id: `u:${i}:${e.time}`,
      kind: "ui",
      time: e.time,
      title: e.msg,
      icon: <Activity className="w-3.5 h-3.5" />,
      tint: "var(--text-tertiary)",
    })
  }

  // Sort newest first by time string heuristics — uiActivity already
  // arrives newest-first, notifications come newest-first from server.
  // We just present the union with notifications taking precedence.

  return (
    <div className="bg-(--bg-card) border border-(--border) rounded-(--radius) px-4 py-3.5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-(--text-primary) m-0">
          Activity
        </h3>
        <span className="text-[10px] text-(--text-tertiary)">
          {items.length} entries
        </span>
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-(--text-tertiary) text-center py-6">
          No activity yet. Start an agent to see events.
        </div>
      ) : (
        <ul className="m-0 p-0 list-none max-h-[300px] overflow-y-auto">
          {items.slice(0, 30).map((it) => (
            <li
              key={it.id}
              className={cn(
                "flex items-start gap-2.5 px-2 py-1.5 rounded-sm",
                "hover:bg-(--bg-input)",
              )}
            >
              <span
                className="shrink-0 mt-[3px]"
                style={{ color: it.tint }}
              >
                {it.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-(--text-primary) wrap-break-word">
                  {it.title}
                </div>
                {it.body && (
                  <div className="text-[11px] text-(--text-secondary) wrap-break-word line-clamp-2">
                    {it.body}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-(--text-tertiary) shrink-0 mt-[3px]">
                {it.time}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
