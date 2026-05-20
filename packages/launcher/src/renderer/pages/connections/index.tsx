import React, { useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { SearchInput } from "../../components/ui/SearchInput"
import { useConnectionsStore } from "../../store/connections"
import { useCredentialsStore } from "../../store/credentials"
import { PLATFORMS, type PlatformDef, platformLabel } from "../../components/connections/platforms"
import { PlatformLogo } from "../../components/connections/PlatformLogo"
import { PlatformCard } from "../../components/connections/PlatformCard"
import { PlatformConnectDialog } from "../../components/connections/PlatformConnectDialog"
import { ConnectionTestDialog } from "../../components/connections/ConnectionTestDialog"
import { ConfirmDialog } from "../../components/ui/ConfirmDialog"
import type { ConnectionRecord } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

export default function Connections({ showToast }: Props): React.JSX.Element {
  const { connections, refresh: refreshConnections } = useConnectionsStore(
    useShallow((s) => ({ connections: s.connections, refresh: s.refresh })),
  )
  const { credentials, refresh: refreshCredentials } = useCredentialsStore(
    useShallow((s) => ({ credentials: s.credentials, refresh: s.refresh })),
  )
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "connected" | "disconnected">("all")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dialogPlatform, setDialogPlatform] = useState<PlatformDef | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectionRecord | null>(null)
  const [testTarget, setTestTarget] = useState<ConnectionRecord | null>(null)

  useEffect(() => {
    refreshConnections()
    refreshCredentials()
  }, [refreshConnections, refreshCredentials])

  const connectionByPlatform = useMemo(() => {
    const m = new Map<string, ConnectionRecord>()
    for (const c of connections) m.set(c.platform, c)
    return m
  }, [connections])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return PLATFORMS.filter((p) => {
      if (q && !p.label.toLowerCase().includes(q) && !p.id.includes(q)) return false
      if (filter === "all") return true
      const conn = connectionByPlatform.get(p.id)
      if (filter === "connected") return conn?.status === "connected"
      if (filter === "disconnected") return !conn || conn.status !== "connected"
      return true
    })
  }, [search, filter, connectionByPlatform])

  // Open the structured ConnectionTestDialog — it auto-runs on mount and
  // shows the status badge + account inline.
  const handleTest = (conn: ConnectionRecord): void => {
    setTestTarget(conn)
  }

  const performDisconnect = async (): Promise<void> => {
    const conn = disconnectTarget
    if (!conn) return
    setBusyId(conn.id)
    try {
      await window.api.removeConnection(conn.id)
      await refreshConnections()
      showToast("Disconnected", "success")
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      setBusyId(null)
      setDisconnectTarget(null)
    }
  }

  const counts = useMemo(() => {
    let connected = 0
    let disconnected = 0
    for (const p of PLATFORMS) {
      const c = connectionByPlatform.get(p.id)
      if (c?.status === "connected") connected++
      else disconnected++
    }
    return { connected, disconnected, total: PLATFORMS.length }
  }, [connectionByPlatform])

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h1 className="mb-1">Connections</h1>
          <p className="text-[12px] text-(--text-tertiary) m-0">
            Manage authorizations to external platforms. Credentials are encrypted on disk.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-(--text-tertiary)">
          <span>
            <span className="text-(--success-text) font-semibold">{counts.connected}</span> connected
          </span>
          <span>·</span>
          <span>{counts.total} platforms</span>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-5 mt-4">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search platforms..."
          className="flex-1 max-w-[280px]"
        />
        <div className="inline-flex items-center gap-1 rounded-(--radius-sm) bg-(--bg-input) p-1">
          {(["all", "connected", "disconnected"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-sm cursor-pointer border-0 transition-all duration-150 ${
                filter === k
                  ? "bg-(--bg-card) text-(--text-primary) shadow-sm"
                  : "bg-transparent text-(--text-secondary)"
              }`}
            >
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="card-grid">
        {visible.map((p) => {
          const conn = connectionByPlatform.get(p.id) || null
          return (
            <PlatformCard
              key={p.id}
              platform={p}
              connection={conn}
              busy={!!conn && busyId === conn.id}
              onConnect={() => setDialogPlatform(p)}
              onReconnect={() => setDialogPlatform(p)}
              onTest={() => conn && handleTest(conn)}
              onDisconnect={() => conn && setDisconnectTarget(conn)}
            />
          )
        })}
      </div>

      {visible.length === 0 && (
        <div className="card-legacy empty-state">
          <p>No platforms match "{search}".</p>
        </div>
      )}

      {dialogPlatform && (
        <PlatformConnectDialog
          open={!!dialogPlatform}
          onClose={() => setDialogPlatform(null)}
          platform={dialogPlatform}
          existing={connectionByPlatform.get(dialogPlatform.id) || null}
          credentials={credentials}
          showToast={showToast}
          onSaved={async () => {
            await refreshConnections()
            await refreshCredentials()
          }}
        />
      )}

      <ConnectionTestDialog
        open={!!testTarget}
        connection={testTarget}
        onClose={() => setTestTarget(null)}
        onAfterRun={() => refreshConnections()}
      />

      <ConfirmDialog
        open={!!disconnectTarget}
        icon={
          disconnectTarget ? (
            <PlatformLogo
              platform={
                PLATFORMS.find((p) => p.id === disconnectTarget.platform) || PLATFORMS[0]
              }
              size={40}
            />
          ) : undefined
        }
        title={
          disconnectTarget
            ? `Disconnect ${platformLabel(disconnectTarget.platform)}?`
            : ""
        }
        description={
          <>
            Linked agents will lose access to{" "}
            <strong>{disconnectTarget ? platformLabel(disconnectTarget.platform) : ""}</strong>
            . The stored credential is kept and can be reused.
          </>
        }
        confirmLabel="Disconnect"
        busy={!!disconnectTarget && busyId === disconnectTarget.id}
        onConfirm={performDisconnect}
        onCancel={() => setDisconnectTarget(null)}
      />
    </section>
  )
}
