import React, { useEffect, useMemo, useState } from "react"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { Label } from "../ui/Label"
import { Select } from "../ui/Select"
import { PasswordInput } from "../ui/PasswordInput"
import { PlatformLogo } from "./PlatformLogo"
import { OAuthConnectButton } from "./OAuthConnectButton"
import type { PlatformDef } from "./platforms"
import type {
  ConnectionRecord,
  ConnectionTestResult,
  CredentialSummary,
} from "../../types"

/**
 * Two-step flow:
 *  1. Pick (or paste) a credential for this platform.
 *  2. Save + automatically test. On success, the connection card flips to
 *     "Connected".
 *
 * Mirrors stage.md §4.2 — "Connect / Disconnect / Reconnect / Test / Configure".
 */
export function PlatformConnectDialog({
  open,
  onClose,
  platform,
  existing,
  credentials,
  onSaved,
  showToast,
}: {
  open: boolean
  onClose: () => void
  platform: PlatformDef
  existing: ConnectionRecord | null
  credentials: CredentialSummary[]
  onSaved: () => Promise<void> | void
  showToast: (msg: string, type?: "info" | "success" | "error" | "warning") => void
}): React.JSX.Element {
  const matchingCreds = useMemo(
    () => credentials.filter((c) => c.provider === platform.id),
    [credentials, platform.id],
  )

  const [credentialId, setCredentialId] = useState<string>(
    existing?.credentialId || matchingCreds[0]?.id || "__new__",
  )
  const [newSecret, setNewSecret] = useState("")
  const [newLabel, setNewLabel] = useState(`${platform.label} default`)
  const [accountHint, setAccountHint] = useState(existing?.account || "")
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)

  useEffect(() => {
    if (!open) return
    setCredentialId(existing?.credentialId || matchingCreds[0]?.id || "__new__")
    setNewSecret("")
    setNewLabel(`${platform.label} default`)
    setAccountHint(existing?.account || "")
    setResult(null)
  }, [open, existing, matchingCreds, platform.label])

  const handleConnect = async (): Promise<void> => {
    setWorking(true)
    setResult(null)
    try {
      // Resolve credential — create one if user picked "new".
      let credId = credentialId
      if (credId === "__new__") {
        if (!newSecret) {
          showToast("Paste a token or API key", "warning")
          setWorking(false)
          return
        }
        const created = await window.api.upsertCredential({
          provider: platform.id,
          kind: platform.defaultCredentialKind,
          label: newLabel.trim() || `${platform.label} default`,
          secret: newSecret,
          shared: true,
        })
        if (!created.ok || !created.record) {
          showToast(created.error || "Failed to save credential", "error")
          setWorking(false)
          return
        }
        credId = created.record.id
      }

      const upserted = await window.api.upsertConnection({
        id: existing?.id,
        platform: platform.id,
        credentialId: credId,
        account: accountHint.trim() || undefined,
        label: existing?.label,
        status: "disconnected",
      })
      const test = await window.api.testConnection(upserted.id)
      setResult(test)
      if (test.ok) {
        showToast(`${platform.label} connected`, "success")
      } else {
        showToast(`Saved, but test failed: ${test.detail || test.status}`, "warning")
      }
      await onSaved()
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="!max-w-[560px] !min-w-[460px]">
      <div className="flex items-center gap-3 mb-5">
        <PlatformLogo platform={platform} size={44} />
        <div>
          <h3 className="text-[17px] font-bold tracking-[-0.02em] m-0">
            {existing ? "Reconnect" : "Connect"} {platform.label}
          </h3>
          <p className="text-[12px] text-(--text-tertiary) m-0">{platform.blurb}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <Label className="mb-1.5">Credential</Label>
          <Select
            value={credentialId}
            onChange={(e) => setCredentialId(e.target.value)}
          >
            <option value="__new__">+ Add new credential</option>
            {matchingCreds.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.kind})
              </option>
            ))}
          </Select>
        </div>

        {credentialId === "__new__" && (
          <>
            <div>
              <Label className="mb-1.5">Credential label</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={`${platform.label} default`}
              />
            </div>
            <div>
              <Label className="mb-1.5">Token / API key</Label>
              <PasswordInput
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder={`Paste your ${platform.label} secret`}
                autoComplete="off"
              />
              {platform.docs && (
                <button
                  type="button"
                  onClick={() => window.api.openExternal(platform.docs!)}
                  className="mt-1.5 text-[11px] text-(--accent) cursor-pointer bg-transparent border-0 p-0 hover:underline"
                >
                  Where do I get this?
                </button>
              )}
            </div>
          </>
        )}

        <div>
          <Label className="mb-1.5">Account hint (optional)</Label>
          <Input
            value={accountHint}
            onChange={(e) => setAccountHint(e.target.value)}
            placeholder="user@example.com or org/repo"
          />
        </div>

        {platform.suggestedScopes && platform.suggestedScopes.length > 0 && (
          <div className="text-[11px] text-(--text-tertiary)">
            Suggested scopes:{" "}
            {platform.suggestedScopes.map((s, i) => (
              <span key={s} className="inline-code">
                {s}{i < platform.suggestedScopes!.length - 1 ? " " : ""}
              </span>
            ))}
          </div>
        )}

        {result && (
          <div
            className={`px-3 py-2 rounded-sm text-[12px] ${
              result.ok
                ? "bg-(--success-bg) text-(--success-text)"
                : "bg-(--danger-bg) text-(--danger-text)"
            }`}
          >
            {result.ok
              ? `Connected${result.account ? ` as ${result.account}` : ""}`
              : `${result.status}${result.detail ? ` — ${result.detail}` : ""}`}
          </div>
        )}
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={working}>
          Cancel
        </Button>
        <OAuthConnectButton platform={platform} />
        <Button variant="primary" onClick={handleConnect} disabled={working}>
          {working ? "Connecting..." : existing ? "Save & Test" : "Connect"}
        </Button>
      </ModalActions>
    </Modal>
  )
}
