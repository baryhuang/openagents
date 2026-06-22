import React, { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
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
      setError(t("github.dialog.errorChooseAgent"))
      return
    }
    if (!repo.trim()) {
      setError(t("github.dialog.errorEnterRepo"))
      return
    }
    if (!credentialId) {
      setError(t("github.dialog.errorPickCredential"))
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
        setError(res.error || t("github.dialog.errorBindFailed"))
        return
      }
      await refreshBindings()
      showToast(
        t("github.toast.bound", {
          owner: res.binding!.owner,
          repo: res.binding!.repo,
          name: agentName,
        }),
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
      title={existing ? t("github.dialog.titleEdit") : t("github.dialog.titleCreate")}
    >
      <FormField label={t("github.dialog.agentLabel")} required>
        <Select
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          disabled={!!existing || busy}
        >
          {agents.length === 0 && <option value="">{t("github.dialog.noAgents")}</option>}
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label={t("github.dialog.repoLabel")}
        required
        hint={t("github.dialog.repoHint")}
      >
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder={t("github.dialog.repoPlaceholder")}
          disabled={busy}
        />
      </FormField>

      <FormField
        label={t("github.dialog.credentialLabel")}
        required
        hint={
          githubCreds.length === 0
            ? t("github.dialog.credentialHint")
            : undefined
        }
      >
        <Select
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
          disabled={busy || githubCreds.length === 0}
        >
          {githubCreds.length === 0 && (
            <option value="">{t("github.dialog.noCredentials")}</option>
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
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy
            ? t("github.dialog.binding")
            : existing
              ? t("github.dialog.update")
              : t("github.dialog.bind")}
        </Button>
      </ModalActions>
    </Modal>
  )
}
