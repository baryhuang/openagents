import React from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { Button } from "../ui/Button"
import { PlatformLogo } from "./PlatformLogo"
import { ConnectionStatusBadge } from "./ConnectionStatusBadge"
import type { PlatformDef } from "./platforms"
import type { ConnectionRecord } from "../../types"

function relativeTime(t: TFunction, iso?: string): string {
  if (!iso) return t("connections.relativeTime.never")
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return t("connections.relativeTime.never")
  const diff = Date.now() - ts
  if (diff < 60_000) return t("connections.relativeTime.justNow")
  if (diff < 3_600_000)
    return t("connections.relativeTime.minutesAgo", { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000)
    return t("connections.relativeTime.hoursAgo", { count: Math.floor(diff / 3_600_000) })
  return t("connections.relativeTime.daysAgo", { count: Math.floor(diff / 86_400_000) })
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
  const { t } = useTranslation()
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
            {t("connections.card.synced", { time: relativeTime(t, connection?.lastSyncAt) })}
          </span>
        </div>
        {connection?.account && (
          <div className="text-(--text-secondary) truncate">
            <span className="text-(--text-tertiary)">{t("connections.card.account")}</span>
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
            {t("connections.card.connect")}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={onTest} disabled={busy}>
              {t("connections.card.test")}
            </Button>
            <Button size="sm" onClick={onReconnect} disabled={busy}>
              {t("connections.card.reconfigure")}
            </Button>
            <Button size="sm" variant="destructive" onClick={onDisconnect} disabled={busy}>
              {t("connections.card.disconnect")}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
