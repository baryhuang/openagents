import React, { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
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
      <Label className="mb-1.5">{t("credentials.editor.scopesLabel")}</Label>
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
              aria-label={t("credentials.editor.removeScope", { scope: s })}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          placeholder={
            value.length === 0
              ? t("credentials.editor.scopesPlaceholderEmpty")
              : t("credentials.editor.scopesPlaceholderAdd")
          }
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
        {t("credentials.editor.scopesHint")}
      </div>
    </div>
  )
}

const KIND_OPTIONS: Array<{ value: CredentialKind; labelKey: string }> = [
  { value: "api_key", labelKey: "credentials.editor.kinds.apiKey" },
  { value: "token", labelKey: "credentials.editor.kinds.token" },
  { value: "oauth", labelKey: "credentials.editor.kinds.oauth" },
  { value: "webhook_secret", labelKey: "credentials.editor.kinds.webhookSecret" },
  { value: "password", labelKey: "credentials.editor.kinds.password" },
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
  const { t } = useTranslation()
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
      showToast(t("credentials.editor.toasts.enterSecretToTest"), "warning")
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
          ? res.account
            ? t("credentials.editor.toasts.connectedAccount", { account: res.account })
            : t("credentials.editor.toasts.connected")
          : t("credentials.editor.toasts.testFailed", { detail: res.detail || res.status }),
        res.ok ? "success" : "error",
      )
    } catch (err) {
      const msg = (err as Error).message
      setTestResult({ ok: false, status: "error", detail: msg })
      showToast(t("credentials.editor.toasts.testFailedError", { message: msg }), "error")
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!draft.label.trim()) {
      showToast(t("credentials.editor.toasts.labelRequired"), "warning")
      return
    }
    if (!draft.id && !draft.secret) {
      showToast(t("credentials.editor.toasts.secretRequired"), "warning")
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
        showToast(
          draft.id ? t("credentials.editor.toasts.updated") : t("credentials.editor.toasts.added"),
          "success",
        )
        onClose()
      } else {
        showToast(res.error || t("credentials.editor.toasts.saveFailed"), "error")
      }
    } catch (err) {
      showToast(t("credentials.editor.toasts.error", { message: (err as Error).message }), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? t("credentials.editor.editTitle") : t("credentials.editor.addTitle")}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5">{t("credentials.editor.providerLabel")}</Label>
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
            <Label className="mb-1.5">{t("credentials.editor.kindLabel")}</Label>
            <Select
              value={draft.kind}
              onChange={(e) =>
                setDraft((d) => ({ ...d, kind: e.target.value as CredentialKind }))
              }
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {t(k.labelKey)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label className="mb-1.5">{t("credentials.editor.labelLabel")}</Label>
          <Input
            value={draft.label}
            placeholder={t("credentials.editor.labelPlaceholder")}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </div>

        <div>
          <Label className="mb-1.5">
            {t("credentials.editor.secretLabel")} {draft.id && <span className="text-(--text-tertiary) normal-case tracking-normal font-normal">{t("credentials.editor.secretKeepHint")}</span>}
          </Label>
          <PasswordInput
            value={draft.secret || ""}
            placeholder={draft.id ? t("credentials.editor.secretPlaceholderExisting") : t("credentials.editor.secretPlaceholderNew")}
            onChange={(e) => setDraft((d) => ({ ...d, secret: e.target.value }))}
            autoComplete="off"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-[13px] font-medium text-(--text-primary)">
              {t("credentials.editor.shareTitle")}
            </span>
            <span className="block text-[11px] text-(--text-tertiary)">
              {t("credentials.editor.shareDescription")}
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
              <>
                {testResult.account
                  ? t("credentials.editor.testOkAccount", { account: testResult.account })
                  : t("credentials.editor.testOk")}
              </>
            ) : (
              <>{t("credentials.editor.testFailedResult", { detail: testResult.detail || testResult.status })}</>
            )}
          </div>
        )}
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          {t("credentials.editor.cancel")}
        </Button>
        <Button onClick={handleTest} disabled={testing || saving}>
          {testing ? t("credentials.editor.testing") : t("credentials.editor.testConnection")}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("credentials.editor.saving") : t("credentials.editor.save")}
        </Button>
      </ModalActions>
    </Modal>
  )
}
