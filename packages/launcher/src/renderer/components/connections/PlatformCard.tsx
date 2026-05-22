import React from "react"
import { Button } from "../ui/Button"
import { PlatformLogo } from "./PlatformLogo"
import { ConnectionStatusBadge } from "./ConnectionStatusBadge"
import type { PlatformDef } from "./platforms"
import type { ConnectionRecord } from "../../types"

function relativeTime(iso?: string): string {
  if (!iso) return "never"
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return "never"
  const diff = Date.now() - t
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function PlatformCard({
  platform,
  connection,
  onConnect,
  onReconnect,
  onTest,
  onDisconnect,
  busy,
}: {
  platform: PlatformDef
  connection: ConnectionRecord | null
  onConnect: () => void
  onReconnect: () => void
  onTest: () => void
  onDisconnect: () => void
  busy: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col h-full bg-(--bg-card) border border-(--border) rounded-(--radius) px-[18px] py-4 shadow-sm transition-all duration-200 hover:shadow-md hover:border-(--border-hover)">
      <div className="flex items-start gap-3 mb-3">
        <PlatformLogo platform={platform} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[13px] tracking-tight text-(--text-primary)">
              {platform.label}
            </span>
          </div>
          <div className="text-[11px] text-(--text-tertiary) leading-snug mt-0.5">
            {platform.blurb}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-3 text-[11px] text-(--text-secondary)">
        <div className="flex items-center justify-between gap-2">
          <ConnectionStatusBadge status={connection?.status || "disconnected"} />
          <span className="text-[10px] text-(--text-tertiary)">
            Synced {relativeTime(connection?.lastSyncAt)}
          </span>
        </div>
        {connection?.account && (
          <div className="text-(--text-secondary) truncate">
            <span className="text-(--text-tertiary)">Account: </span>
            {connection.account}
          </div>
        )}
        {connection?.lastError && connection.status !== "connected" && (
          <div className="text-(--danger-text) truncate" title={connection.lastError}>
            {connection.lastError}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-auto pt-2">
        {!connection ? (
          <Button size="sm" variant="primary" onClick={onConnect} disabled={busy}>
            Connect
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={onTest} disabled={busy}>
              Test
            </Button>
            <Button size="sm" onClick={onReconnect} disabled={busy}>
              Reconfigure
            </Button>
            <Button size="sm" variant="destructive" onClick={onDisconnect} disabled={busy}>
              Disconnect
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
