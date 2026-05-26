import React, { useEffect, useMemo, useState } from "react"
import { capture } from "../../lib/analytics"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { Label } from "../ui/Label"
import { PasswordInput } from "../ui/PasswordInput"
import { Select } from "../ui/Select"
import { Switch } from "../ui/Switch"
import { PLATFORMS } from "../connections/platforms"
import type {
  ConnectionTestResult,
  CredentialKind,
  CredentialSummary,
} from "../../types"

/** Compact tag-style editor for credential scopes (stage.md §4.4 — "Key 权限控制"). */
function ScopeEditor({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState("")

  const add = (raw: string): void => {
    const v = raw.trim()
    if (!v) return
    if (value.includes(v)) return
    onChange([...value, v])
    setDraft("")
  }

  const remove = (s: string): void => {
    onChange(value.filter((x) => x !== s))
  }

  return (
    <div>
      <Label className="mb-1.5">Scopes (optional)</Label>
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-(--bg-input) rounded-sm min-h-[34px]">
        {value.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-(--accent-bg) text-(--text-link) text-[11px]"
          >
            {s}
            <button
              type="button"
              onClick={() => remove(s)}
              className="bg-transparent border-0 p-0 cursor-pointer text-(--text-link) hover:text-(--danger-text)"
              aria-label={`Remove scope ${s}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          placeholder={value.length === 0 ? "e.g. read, write, repo, chat:write" : "Add scope..."}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              add(draft)
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              remove(value[value.length - 1])
            }
          }}
          onBlur={() => add(draft)}
          className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-[12px] text-(--text-primary) placeholder:text-(--text-tertiary)"
        />
      </div>
      <div className="text-[11px] text-(--text-tertiary) mt-1.5">
        Used for documentation only — actual platform permissions are set when you generate the token.
      </div>
    </div>
  )
}

const KIND_OPTIONS: Array<{ value: CredentialKind; label: string }> = [
  { value: "api_key", label: "API Key" },
  { value: "token", label: "Token" },
  { value: "oauth", label: "OAuth" },
  { value: "webhook_secret", label: "Webhook Secret" },
  { value: "password", label: "Password" },
]

export interface CredentialDraft {
  id?: string
  provider: string
  kind: CredentialKind
  label: string
  secret?: string
  shared: boolean
  scopes: string[]
}

export function CredentialEditor({
  open,
  onClose,
  initial,
  onSaved,
  showToast,
  /** When set, locks the provider dropdown to this value (used by ConnectionsHub). */
  lockedProvider,
}: {
  open: boolean
  onClose: () => void
  initial?: CredentialSummary | null
  onSaved: (cred: CredentialSummary) => void
  showToast: (msg: string, type?: "info" | "success" | "error" | "warning") => void
  lockedProvider?: string
}): React.JSX.Element {
  const defaults = useMemo<CredentialDraft>(() => {
    if (initial) {
      return {
        id: initial.id,
        provider: initial.provider,
        kind: initial.kind,
        label: initial.label,
        secret: "",
        shared: initial.shared,
        scopes: initial.scopes || [],
      }
    }
    const provider = lockedProvider || "openai"
    const def = PLATFORMS.find((p) => p.id === provider)
    return {
      provider,
      kind: def?.defaultCredentialKind || "api_key",
      label: def ? `${def.label} default` : "",
      secret: "",
      shared: true,
      scopes: [],
    }
  }, [initial, lockedProvider])

  const [draft, setDraft] = useState<CredentialDraft>(defaults)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(defaults)
      setTestResult(null)
    }
  }, [open, defaults])

  const updateProvider = (provider: string): void => {
    const def = PLATFORMS.find((p) => p.id === provider)
    setDraft((d) => ({
      ...d,
      provider,
      kind: def?.defaultCredentialKind ?? d.kind,
      label: d.label || (def ? `${def.label} default` : ""),
    }))
    setTestResult(null)
  }

  const handleTest = async (): Promise<void> => {
    if (!draft.secret && !draft.id) {
      showToast("Enter a secret to test", "warning")
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.api.testCredential({
        id: draft.id,
        provider: draft.provider,
        secret: draft.secret || undefined,
      })
      setTestResult(res)
      showToast(
        res.ok
          ? `Connected${res.account ? ` as ${res.account}` : ""}`
          : `Test failed: ${res.detail || res.status}`,
        res.ok ? "success" : "error",
      )
    } catch (err) {
      const msg = (err as Error).message
      setTestResult({ ok: false, status: "error", detail: msg })
      showToast(`Test failed: ${msg}`, "error")
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!draft.label.trim()) {
      showToast("Label is required", "warning")
      return
    }
    if (!draft.id && !draft.secret) {
      showToast("Secret is required when creating a credential", "warning")
      return
    }
    setSaving(true)
    try {
      const res = await window.api.upsertCredential({
        id: draft.id,
        provider: draft.provider,
        kind: draft.kind,
        label: draft.label.trim(),
        secret: draft.secret || undefined,
        shared: draft.shared,
        scopes: draft.scopes,
      })
      if (res.ok && res.record) {
        capture("credential_saved", { provider: draft.provider, kind: draft.kind, is_update: !!draft.id })
        onSaved(res.record)
        showToast(draft.id ? "Credential updated" : "Credential added", "success")
        onClose()
      } else {
        showToast(res.error || "Failed to save credential", "error")
      }
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? "Edit credential" : "Add credential"}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5">Provider</Label>
            <Select
              value={draft.provider}
              onChange={(e) => updateProvider(e.target.value)}
              disabled={!!lockedProvider || !!draft.id}
            >
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="mb-1.5">Kind</Label>
            <Select
              value={draft.kind}
              onChange={(e) =>
                setDraft((d) => ({ ...d, kind: e.target.value as CredentialKind }))
              }
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label className="mb-1.5">Label</Label>
          <Input
            value={draft.label}
            placeholder="e.g. OpenAI production"
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </div>

        <div>
          <Label className="mb-1.5">
            Secret {draft.id && <span className="text-(--text-tertiary) normal-case tracking-normal font-normal">(leave blank to keep existing)</span>}
          </Label>
          <PasswordInput
            value={draft.secret || ""}
            placeholder={draft.id ? "•••••••• (hidden)" : "Paste API key or token"}
            onChange={(e) => setDraft((d) => ({ ...d, secret: e.target.value }))}
            autoComplete="off"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-[13px] font-medium text-(--text-primary)">
              Share with multiple agents
            </span>
            <span className="block text-[11px] text-(--text-tertiary)">
              Allow any agent to reference this credential
            </span>
          </div>
          <Switch
            checked={draft.shared}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, shared: v }))}
          />
        </div>

        <ScopeEditor
          value={draft.scopes}
          onChange={(scopes) => setDraft((d) => ({ ...d, scopes }))}
        />

        {testResult && (
          <div
            className={`px-3 py-2 rounded-sm text-[12px] ${
              testResult.ok
                ? "bg-(--success-bg) text-(--success-text)"
                : "bg-(--danger-bg) text-(--danger-text)"
            }`}
          >
            {testResult.ok ? (
              <>Test ok{testResult.account ? ` — ${testResult.account}` : ""}</>
            ) : (
              <>Failed: {testResult.detail || testResult.status}</>
            )}
          </div>
        )}
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleTest} disabled={testing || saving}>
          {testing ? "Testing..." : "Test connection"}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </ModalActions>
    </Modal>
  )
}
