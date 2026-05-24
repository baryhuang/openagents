import React, { useEffect, useState } from "react"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { Label } from "../ui/Label"
import type { Workspace } from "../../types"

/**
 * Rename a workspace locally. The launcher's connector doesn't expose a
 * server-side rename today, so this writes to settings.json under
 * `workspace-aliases:<id>` and the Workspaces page reads it back. Falls back
 * to the connector's name when no alias is set.
 *
 * stage.md §4.1 — "Workspace 操作 / 编辑".
 */
export function WorkspaceRenameDialog({
  open,
  workspace,
  onClose,
  onSaved,
}: {
  open: boolean
  workspace: Workspace | null
  onClose: () => void
  onSaved: (id: string, name: string) => void
}): React.JSX.Element {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && workspace) {
      setName(workspace.name || workspace.slug || workspace.id)
    }
  }, [open, workspace])

  const handleSave = async (): Promise<void> => {
    if (!workspace) return
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const key = `workspace-aliases:${workspace.id}`
      await window.api.setSetting(key, trimmed)
      onSaved(workspace.id, trimmed)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Rename workspace">
      <div className="flex flex-col gap-3">
        <div>
          <Label className="mb-1.5">Display name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="My Team"
          />
          <div className="text-[11px] text-(--text-tertiary) mt-1.5">
            Display-only. The slug ({workspace?.slug || workspace?.id}) and
            server-side name are unchanged.
          </div>
        </div>
      </div>
      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={busy || !name.trim()}>
          {busy ? "Saving..." : "Save"}
        </Button>
      </ModalActions>
    </Modal>
  )
}
