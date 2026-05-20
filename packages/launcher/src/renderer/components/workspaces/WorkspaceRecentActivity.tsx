import * as React from "react"

export interface RecentActivityProps {
  /** ISO timestamp of the workspace's most recent message (any channel). */
  lastMessageAt: string | null
  /** Short preview of that message. */
  lastMessagePreview: string | null
  /** Number of stored sessions for this workspace. */
  sessionCount: number
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never"
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return "never"
  const diff = Date.now() - t
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function WorkspaceRecentActivity({
  lastMessageAt,
  lastMessagePreview,
  sessionCount,
}: RecentActivityProps): React.JSX.Element {
  if (!lastMessageAt) {
    return (
      <div className="text-[11px] text-(--text-tertiary) italic">
        No recent activity{sessionCount > 0 ? ` (${sessionCount} sessions)` : ""}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10px] text-(--text-tertiary) uppercase tracking-wider">
        Last message · {relativeTime(lastMessageAt)}
      </div>
      <div className="text-[11px] text-(--text-secondary) truncate">
        {lastMessagePreview || "(no preview)"}
      </div>
    </div>
  )
}

export { relativeTime as workspaceRelativeTime }
