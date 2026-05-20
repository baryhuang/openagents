import React, { useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "../../components/ui/Button"
import { SearchInput } from "../../components/ui/SearchInput"
import { CredentialCard } from "../../components/credentials/CredentialCard"
import { CredentialEditor } from "../../components/credentials/CredentialEditor"
import { CredentialApplyDialog } from "../../components/credentials/CredentialApplyDialog"
import { ConfirmDialog } from "../../components/ui/ConfirmDialog"
import { useAgentsStore } from "../../store/agents"
import { useCredentialsStore } from "../../store/credentials"
import { useConnectionsStore } from "../../store/connections"
import { PLATFORMS, getPlatform } from "../../components/connections/platforms"
import { PlatformLogo } from "../../components/connections/PlatformLogo"
import type { CredentialSummary, ConnectionTestResult } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

export default function Credentials({ showToast }: Props): React.JSX.Element {
  const { credentials, refresh } = useCredentialsStore(
    useShallow((s) => ({ credentials: s.credentials, refresh: s.refresh })),
  )
  const { connections, refresh: refreshConnections } = useConnectionsStore(
    useShallow((s) => ({ connections: s.connections, refresh: s.refresh })),
  )
  const [search, setSearch] = useState("")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<CredentialSummary | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<CredentialSummary | null>(null)
  const [removing, setRemoving] = useState(false)
  const [applyTarget, setApplyTarget] = useState<CredentialSummary | null>(null)

  // Ensure the apply-dialog's "Target agent types" list reflects what's
  // currently configured (CredentialApplyDialog reads from useAgentsStore).
  useEffect(() => {
    refresh()
    refreshConnections()
    void window.api.listAgents().then((a) => useAgentsStore.getState().setAgents(a))
  }, [refresh, refreshConnections])

  // Cross-link credentials with their connection usage from connections state
  // (since the main-process store keeps `usedByConnections` lazily and this
  // gives the UI a fresh count without waiting for the next refresh).
  const decorated = useMemo(() => {
    return credentials.map((c) => {
      const usedByConn = connections.filter((conn) => conn.credentialId === c.id).map((conn) => conn.id)
      return {
        ...c,
        usedByConnections: usedByConn.length ? usedByConn : c.usedByConnections,
      }
    })
  }, [credentials, connections])

  const providers = useMemo(() => {
    const set = new Set(credentials.map((c) => c.provider))
    return Array.from(set).sort()
  }, [credentials])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return decorated.filter((c) => {
      if (providerFilter !== "all" && c.provider !== providerFilter) return false
      if (!q) return true
      return (
        c.label.toLowerCase().includes(q) ||
        c.provider.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q)
      )
    })
  }, [decorated, search, providerFilter])

  const handleReveal = async (id: string): Promise<void> => {
    if (revealed[id]) {
      setRevealed((r) => {
        const n = { ...r }
        delete n[id]
        return n
      })
      return
    }
    try {
      const r = await window.api.revealCredential(id)
      if (r.ok && r.secret) {
        setRevealed((prev) => ({ ...prev, [id]: r.secret! }))
      } else {
        showToast(r.error || "Failed to reveal", "error")
      }
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  const performRemove = async (): Promise<void> => {
    const cred = removeTarget
    if (!cred) return
    setRemoving(true)
    try {
      await window.api.removeCredential(cred.id)
      await refresh()
      await refreshConnections()
      showToast("Credential removed", "success")
      setRemoveTarget(null)
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      setRemoving(false)
    }
  }

  const handleTest = async (cred: CredentialSummary): Promise<void> => {
    setTesting(cred.id)
    try {
      const r: ConnectionTestResult = await window.api.testCredential({
        id: cred.id,
        provider: cred.provider,
      })
      await refresh()
      showToast(
        r.ok
          ? `Test passed${r.account ? ` — ${r.account}` : ""}`
          : `Test failed: ${r.detail || r.status}`,
        r.ok ? "success" : "error",
      )
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      setTesting(null)
    }
  }

  const openAdd = (): void => {
    setEditing(null)
    setEditorOpen(true)
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h1 className="mb-1">Credentials</h1>
          <p className="text-[12px] text-(--text-tertiary) m-0">
            Encrypted at rest. Never logged. One key can be reused across multiple agents.
          </p>
        </div>
        <Button variant="primary" onClick={openAdd}>
          <Plus className="w-3.5 h-3.5" />
          Add credential
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-5 mt-4 flex-wrap">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search credentials..."
          className="flex-1 min-w-[200px] max-w-[300px]"
        />
        <div className="inline-flex items-center gap-1 rounded-(--radius-sm) bg-(--bg-input) p-1 flex-wrap">
          <button
            type="button"
            onClick={() => setProviderFilter("all")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-sm cursor-pointer border-0 transition-all duration-150 ${
              providerFilter === "all"
                ? "bg-(--bg-card) text-(--text-primary) shadow-sm"
                : "bg-transparent text-(--text-secondary)"
            }`}
          >
            All
          </button>
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProviderFilter(p)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-sm cursor-pointer border-0 transition-all duration-150 ${
                providerFilter === p
                  ? "bg-(--bg-card) text-(--text-primary) shadow-sm"
                  : "bg-transparent text-(--text-secondary)"
              }`}
            >
              {getPlatform(p)?.label || p}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card-legacy empty-state">
          <p>
            {credentials.length === 0
              ? "No credentials yet. Add one to share keys across agents."
              : `No credentials match "${search}".`}
          </p>
          {credentials.length === 0 && (
            <Button variant="primary" onClick={openAdd}>
              Add your first credential
            </Button>
          )}
        </div>
      ) : (
        <div>
          {visible.map((c) => (
            <CredentialCard
              key={c.id}
              cred={c}
              revealed={revealed[c.id] || null}
              testing={testing === c.id}
              onEdit={() => {
                setEditing(c)
                setEditorOpen(true)
              }}
              onRemove={() => setRemoveTarget(c)}
              onTest={() => handleTest(c)}
              onReveal={() => handleReveal(c.id)}
              onApply={() => setApplyTarget(c)}
            />
          ))}
        </div>
      )}

      <div className="card-legacy mt-5">
        <h3>Storage</h3>
        <p className="text-[12px] text-(--text-secondary) mb-2 leading-relaxed">
          Secrets are encrypted with AES-256-GCM using a key wrapped by your OS
          keychain ({navigator.platform.includes("Mac")
            ? "macOS Keychain"
            : navigator.platform.includes("Win")
              ? "Windows Credential Manager"
              : "Linux Secret Service"}).
          The encrypted file lives under your Launcher userData directory and is
          chmod 600 on Unix.
        </p>
        <p className="text-[11px] text-(--text-tertiary) m-0">
          {PLATFORMS.length} platforms supported.
        </p>
      </div>

      <CredentialEditor
        open={editorOpen}
        initial={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          refresh()
          refreshConnections()
        }}
        showToast={showToast}
      />

      <CredentialApplyDialog
        open={!!applyTarget}
        credential={applyTarget}
        onClose={() => setApplyTarget(null)}
        onApplied={() => {
          refresh()
        }}
        showToast={showToast}
      />

      <ConfirmDialog
        open={!!removeTarget}
        icon={
          removeTarget && getPlatform(removeTarget.provider) ? (
            <PlatformLogo platform={getPlatform(removeTarget.provider)!} size={40} />
          ) : undefined
        }
        title={removeTarget ? `Delete "${removeTarget.label}"?` : ""}
        description={
          <>
            Any connection using this credential will be marked{" "}
            <strong>Unauthorized</strong>. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        busy={removing}
        onConfirm={performRemove}
        onCancel={() => !removing && setRemoveTarget(null)}
      />
    </section>
  )
}
