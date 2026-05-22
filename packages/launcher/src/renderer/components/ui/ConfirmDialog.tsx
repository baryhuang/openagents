import * as React from "react"
import { Modal, ModalTitle } from "./Modal"
import { Button } from "./Button"

/**
 * Centered-icon confirmation modal — mirrors the look of
 * UninstallConfirmModal and Agents' Remove dialog so destructive actions
 * stay consistent across the app.
 */
export function ConfirmDialog({
  open,
  icon,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Modal open={open} onClose={onCancel}>
      <div className="flex flex-col items-center py-2">
        {icon}
        <ModalTitle className={icon ? "mt-3 text-center" : "text-center"}>
          {title}
        </ModalTitle>
        {description && (
          <p className="hint mt-3 mb-5 text-center">{description}</p>
        )}
        <div className="form-actions justify-center mt-0">
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working..." : confirmLabel}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
