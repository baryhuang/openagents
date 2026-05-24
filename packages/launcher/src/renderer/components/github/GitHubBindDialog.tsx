import React, { useEffect, useMemo, useState } from "react"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { Select } from "../ui/Select"
import { FormField } from "../ui/FormField"
import { useAgentsStore } from "../../store/agents"
import { useCredentialsStore } from "../../store/credentials"
import { useGitHubStore } from "../../store/github"
import type { GitHubBinding } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface Props {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
  /** Pre-select an agent (e.g. opened from an agent card). */
  initialAgent?: string | null
  /** Pre-fill from an existing binding (rebind flow). */
  existing?: GitHubBinding | null
}

export function GitHubBindDialog({
  open,
  onClose,
  showToast,
  initialAgent,
  existing,
}: Props): React.JSX.Element {
  const agents = useAgentsStore((s) => s.agents)
  const credentials = useCredentialsStore((s) => s.credentials)
  const refreshBindings = useGitHubStore((s) => s.refresh)

  const githubCreds = useMemo(
    () => credentials.filter((c) => c.provider === "github"),
    [credentials],
  )

  const [agentName, setAgentName] = useState<string>("")
  const [repo, setRepo] = useState<string>("")
  const [credentialId, setCredentialId] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (existing) {
      setAgentName(existing.agentName)
      setRepo(`${existing.owner}/${existing.repo}`)
      setCredentialId(existing.credentialId)
    } else {
      setAgentName(initialAgent || agents[0]?.name || "")
      setRepo("")
      setCredentialId(githubCreds[0]?.id || "")
    }
  }, [open, existing, initialAgent, agents, githubCreds])

  const submit = async (): Promise<void> => {
    setError(null)
    if (!agentName) {
      setError("Choose an agent to bind")
      return
    }
    if (!repo.trim()) {
      setError("Enter a repo (owner/name or URL)")
      return
    }
    if (!credentialId) {
      setError("Pick a GitHub credential")
      return
    }
    setBusy(true)
    try {
      const res = await window.api.githubBindRepo({
        agentName,
        repo: repo.trim(),
        credentialId,
      })
      if (!res.ok) {
        setError(res.error || "Failed to bind repo")
        return
      }
      await refreshBindings()
      showToast(
        `Bound ${res.binding!.owner}/${res.binding!.repo} → ${agentName}`,
        "success",
      )
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={existing ? "Update GitHub binding" : "Bind agent to GitHub repo"}
    >
      <FormField label="Agent" required>
        <Select
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          disabled={!!existing || busy}
        >
          {agents.length === 0 && <option value="">(no agents)</option>}
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Repository"
        required
        hint="Accepts owner/name, full URL, or git@github.com:owner/name.git"
      >
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="anthropics/claude-code"
          disabled={busy}
        />
      </FormField>

      <FormField
        label="Credential"
        required
        hint={
          githubCreds.length === 0
            ? "Add a GitHub credential under Credentials first."
            : undefined
        }
      >
        <Select
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
          disabled={busy || githubCreds.length === 0}
        >
          {githubCreds.length === 0 && (
            <option value="">(no GitHub credentials)</option>
          )}
          {githubCreds.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormField>

      {error && (
        <div className="px-3 py-2 rounded-sm bg-(--danger-bg) text-(--danger-text) text-[11px] mb-3 break-words">
          {error}
        </div>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? "Binding..." : existing ? "Update" : "Bind"}
        </Button>
      </ModalActions>
    </Modal>
  )
}
