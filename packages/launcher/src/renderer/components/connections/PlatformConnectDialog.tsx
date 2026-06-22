import React, { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
  const matchingCreds = useMemo(
    () => credentials.filter((c) => c.provider === platform.id),
    [credentials, platform.id],
  )

  const [credentialId, setCredentialId] = useState<string>(
    existing?.credentialId || matchingCreds[0]?.id || "__new__",
  )
  const [newSecret, setNewSecret] = useState("")
  const [newLabel, setNewLabel] = useState(
    t("connections.dialog.defaultLabel", { platform: platform.label }),
  )
  const [accountHint, setAccountHint] = useState(existing?.account || "")
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)

  useEffect(() => {
    if (!open) return
    setCredentialId(existing?.credentialId || matchingCreds[0]?.id || "__new__")
    setNewSecret("")
    setNewLabel(t("connections.dialog.defaultLabel", { platform: platform.label }))
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
          showToast(t("connections.toast.pasteToken"), "warning")
          setWorking(false)
          return
        }
        const created = await window.api.upsertCredential({
          provider: platform.id,
          kind: platform.defaultCredentialKind,
          label: newLabel.trim() || t("connections.dialog.defaultLabel", { platform: platform.label }),
          secret: newSecret,
          shared: true,
        })
        if (!created.ok || !created.record) {
          showToast(created.error || t("connections.toast.saveCredentialFailed"), "error")
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
        showToast(t("connections.toast.connected", { platform: platform.label }), "success")
      } else {
        showToast(
          t("connections.toast.testFailed", { detail: test.detail || test.status }),
          "warning",
        )
      }
      await onSaved()
    } catch (err) {
      showToast(t("connections.toast.error", { message: (err as Error).message }), "error")
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
            {existing
              ? t("connections.dialog.reconnectTitle", { platform: platform.label })
              : t("connections.dialog.connectTitle", { platform: platform.label })}
          </h3>
          <p className="text-[12px] text-(--text-tertiary) m-0">{platform.blurb}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <Label className="mb-1.5">{t("connections.dialog.credential")}</Label>
          <Select
            value={credentialId}
            onChange={(e) => setCredentialId(e.target.value)}
          >
            <option value="__new__">{t("connections.dialog.addNewCredential")}</option>
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
              <Label className="mb-1.5">{t("connections.dialog.credentialLabel")}</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t("connections.dialog.defaultLabel", { platform: platform.label })}
              />
            </div>
            <div>
              <Label className="mb-1.5">{t("connections.dialog.tokenOrApiKey")}</Label>
              <PasswordInput
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder={t("connections.dialog.pasteSecret", { platform: platform.label })}
                autoComplete="off"
              />
              {platform.docs && (
                <button
                  type="button"
                  onClick={() => window.api.openExternal(platform.docs!)}
                  className="mt-1.5 text-[11px] text-(--accent) cursor-pointer bg-transparent border-0 p-0 hover:underline"
                >
                  {t("connections.dialog.whereToGet")}
                </button>
              )}
            </div>
          </>
        )}

        <div>
          <Label className="mb-1.5">{t("connections.dialog.accountHint")}</Label>
          <Input
            value={accountHint}
            onChange={(e) => setAccountHint(e.target.value)}
            placeholder={t("connections.dialog.accountHintPlaceholder")}
          />
        </div>

        {platform.suggestedScopes && platform.suggestedScopes.length > 0 && (
          <div className="text-[11px] text-(--text-tertiary)">
            {t("connections.dialog.suggestedScopes")}
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
              ? result.account
                ? t("connections.dialog.connectedAs", { account: result.account })
                : t("connections.dialog.connectedOk")
              : result.detail
                ? t("connections.dialog.resultError", { status: result.status, detail: result.detail })
                : t("connections.dialog.resultStatus", { status: result.status })}
          </div>
        )}
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={working}>
          {t("connections.dialog.cancel")}
        </Button>
        <OAuthConnectButton platform={platform} />
        <Button variant="primary" onClick={handleConnect} disabled={working}>
          {working
            ? t("connections.dialog.connecting")
            : existing
              ? t("connections.dialog.saveAndTest")
              : t("connections.dialog.connect")}
        </Button>
      </ModalActions>
    </Modal>
  )
}
