import React from "react"
import { Modal, ModalTitle } from "../ui/Modal"
import { Button } from "../ui/Button"
import AgentIcon from "../AgentIcon"
import type { CatalogEntry } from "../../types"

interface InstallConfirmModalProps {
  open: boolean
  verb: "install" | "update"
  entry: CatalogEntry | null
  onConfirm: () => void
  onCancel: () => void
}

function detectPlatform(): "macos" | "linux" | "windows" {
  if (typeof navigator === "undefined") return "linux"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("win")) return "windows"
  if (ua.includes("mac")) return "macos"
  return "linux"
}

/**
 * Two-step confirmation modal that mirrors launcher-legacy's
 * `installCatalogItem()` behaviour — surfacing the exact shell command that
 * is about to run on the user's machine so they can opt out before something
 * touches their PATH / system.
 *
 * Shown by:
 *   - AgentDetail (Install / Update button)
 *   - Install marketplace list (AgentCard / AgentRow primary action)
 */
export function InstallConfirmModal({
  open,
  verb,
  entry,
  onConfirm,
  onCancel,
}: InstallConfirmModalProps): React.JSX.Element | null {
  if (!entry) return null

  const platformKey = detectPlatform()
  const installCmd = entry.install?.[platformKey]
  const verbLabel = verb === "update" ? "Update" : "Install"
  const label = entry.label || entry.name

  return (
    <Modal open={open} onClose={onCancel}>
      <div className="flex flex-col items-center" style={{ padding: "8px 0" }}>
        <AgentIcon type={entry.name} size={40} />
        <ModalTitle style={{ marginTop: 12, textAlign: "center" }}>
          {verbLabel} {label}?
        </ModalTitle>
        <p
          className="hint"
          style={{ margin: "12px 0 8px", textAlign: "center", maxWidth: 360 }}
        >
          {installCmd ? (
            <>
              This will run the following command on your system:
            </>
          ) : (
            <>This will {verb} <strong>{label}</strong> on your system.</>
          )}
        </p>
        {installCmd && (
          <code className="text-[11.5px] px-2.5 py-1.5 bg-(--bg-input) text-(--text-primary) font-mono rounded-(--radius) max-w-[min(420px,80vw)] whitespace-pre-wrap break-all text-center">
            {installCmd}
          </code>
        )}
        <div
          className="form-actions"
          style={{ justifyContent: "center", marginTop: 20 }}
        >
          <Button variant="primary" onClick={onConfirm}>
            {verbLabel}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
