import React, { useEffect, useState } from "react"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { Label } from "../ui/Label"
import { useAgentsStore } from "../../store/agents"
import { getPlatform } from "../connections/platforms"
import type { CredentialSummary } from "../../types"
import type { ToastType } from "../../hooks/useToast"

/**
 * Writes a credential's secret into one or more agent .env files under a
 * caller-chosen env-var key. Bridges the encrypted Credentials store to the
 * legacy ~/.openagents/env/<type>.env files that resolve_env reads.
 *
 * stage.md §4.4 — image: "src/env.js 增强".
 */
export function CredentialApplyDialog({
  open,
  onClose,
  credential,
  onApplied,
  showToast,
}: {
  open: boolean
  onClose: () => void
  credential: CredentialSummary | null
  onApplied: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const agents = useAgentsStore((s) => s.agents)
  const platform = credential ? getPlatform(credential.provider) : undefined
  const [envKey, setEnvKey] = useState<string>(platform?.defaultEnvKey || "")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // De-dupe by agent type — we apply per-type, not per-agent-instance, because
  // the resolve_env file lives at ~/.openagents/env/<type>.env.
  const types = Array.from(new Set(agents.map((a) => a.type))).sort()

  useEffect(() => {
    if (!open) return
    setEnvKey(platform?.defaultEnvKey || "")
    // Preselect types that already list this credential in their usedByAgents.
    const pre = new Set<string>(credential?.usedByAgents || [])
    setSelected(pre)
  }, [open, platform, credential])

  const toggleType = (t: string): void => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })
  }

  const handleApply = async (): Promise<void> => {
    if (!credential) return
    if (!envKey.trim()) {
      showToast("Env variable name is required", "warning")
      return
    }
    if (selected.size === 0) {
      showToast("Pick at least one agent type", "warning")
      return
    }
    setBusy(true)
    try {
      const res = await window.api.applyCredentialToAgents({
        credentialId: credential.id,
        envKey: envKey.trim(),
        agentTypes: Array.from(selected),
      })
      if (res.ok) {
        showToast(
          `Applied to ${res.written?.length || 0} agent type${res.written?.length === 1 ? "" : "s"}`,
          "success",
        )
        onApplied()
        onClose()
      } else {
        showToast(res.error || (res.errors || []).join("; ") || "Apply failed", "error")
      }
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={credential ? `Apply "${credential.label}" to agents` : "Apply credential"}
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label className="mb-1.5">Env variable name</Label>
          <Input
            value={envKey}
            onChange={(e) => setEnvKey(e.target.value.toUpperCase())}
            placeholder="OPENAI_API_KEY"
            autoFocus
          />
          <div className="text-[11px] text-(--text-tertiary) mt-1.5">
            Written to <code className="inline-code">~/.openagents/env/&lt;type&gt;.env</code>.
            resolve_env rules in each agent map this to provider-specific vars.
          </div>
        </div>

        <div>
          <Label className="mb-1.5">Target agent types</Label>
          {types.length === 0 ? (
            <div className="text-[12px] text-(--text-tertiary) px-3 py-2 bg-(--bg-input) rounded-sm">
              No agents configured yet. Add an agent in the Agents tab first.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
              {types.map((t) => {
                const active = selected.has(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-sm cursor-pointer border transition-all duration-150 ${
                      active
                        ? "bg-(--accent) text-white border-transparent"
                        : "bg-(--bg-input) text-(--text-secondary) border-transparent hover:border-(--accent-border)"
                    }`}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="text-[11px] text-(--text-tertiary) leading-relaxed bg-(--bg-input) px-3 py-2 rounded-sm">
          Existing keys in each <code className="inline-code">.env</code> file
          are preserved. Only <strong>{envKey || "<env key>"}</strong> will be
          overwritten with this credential's secret. The agent will be signaled
          to reload its env after the write.
        </div>
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply} disabled={busy || types.length === 0}>
          {busy ? "Applying..." : "Apply"}
        </Button>
      </ModalActions>
    </Modal>
  )
}
