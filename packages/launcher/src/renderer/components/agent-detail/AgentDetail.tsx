import React, { useCallback, useEffect, useState } from "react"
import { Button } from "../ui/Button"
import { Modal, ModalTitle } from "../ui/Modal"
import AgentIcon from "../AgentIcon"
import { useInstallStore } from "../../store/install"
import type {
  AgentUpdateInfo,
  CatalogEntry,
  EnvField,
  HealthCheck,
  InstalledAgentRecord,
} from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { AgentHeader } from "./AgentHeader"
import { AgentInstallActions } from "./AgentInstallActions"
import { AgentReadme } from "./AgentReadme"
import { AgentScreenshots } from "./AgentScreenshots"
import { AgentSystemRequirements, AgentDependencies } from "./AgentDependencies"
import { AgentEnvConfig } from "./AgentEnvConfig"
import { AgentQuickStart } from "./AgentQuickStart"
import { AgentChangelog } from "./AgentChangelog"
import { InstallConfirmModal } from "./InstallConfirmModal"
import { ChannelSelector } from "./ChannelSelector"
import { StagedProgress } from "../install-progress/StagedProgress"
import { useAgentChannel, channelToDistTag } from "../../hooks/useAgentChannel"

interface AgentDetailProps {
  entry: CatalogEntry
  onBack: () => void
  onAfterInstall: (entry: CatalogEntry) => void
  onOpenWizard?: (entry: CatalogEntry) => void
  showToast: (msg: string, type?: ToastType) => void
}

interface ChangelogState {
  versions: Array<{ version: string; date?: string }>
  homepage?: string
  latest?: string | null
  error?: string
  loading: boolean
}

/**
 * Detail page orchestrator. Owns the IPC fetches (env_config, installed
 * record, update info, healthCheck, changelog) and the install/uninstall/
 * rollback handlers. Layout-wise it's a single column at narrow widths and
 * a two-column with a sticky right action rail at >=lg widths.
 */
export default function AgentDetail({
  entry,
  onBack,
  onAfterInstall,
  onOpenWizard,
  showToast,
}: AgentDetailProps): React.JSX.Element {
  const [envFields, setEnvFields] = useState<EnvField[]>([])
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [installed, setInstalled] = useState<InstalledAgentRecord | null>(null)
  const [update, setUpdate] = useState<AgentUpdateInfo | null>(null)
  const [health, setHealth] = useState<HealthCheck | null>(null)
  const [changelog, setChangelog] = useState<ChangelogState>({ versions: [], loading: true })
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)
  // Two-step confirmation before install / update kicks off — matches
  // launcher-legacy's installCatalogItem() flow.
  const [confirmingInstall, setConfirmingInstall] = useState<"install" | "update" | null>(null)
  const { channel, setChannel } = useAgentChannel(entry.name)
  const job = useInstallStore((s) => s.jobs[entry.name])
  const jobPhase = job?.phase

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [fields, savedEnv, list, updates, change, healthInfo] = await Promise.all([
          window.api.getEnvFields(entry.name).catch(() => [] as EnvField[]),
          window.api.getAgentEnv(entry.name).catch(() => ({}) as Record<string, string>),
          window.api.getInstalledAgents().catch(() => []),
          window.api.checkAgentUpdates().catch(() => []),
          window.api.getAgentChangelog(entry.name).catch(() => ({
            versions: [] as Array<{ version: string; date?: string }>,
            homepage: undefined as string | undefined,
            latest: null as string | null,
            error: undefined as string | undefined,
          })),
          entry.installed ? window.api.healthCheck(entry.name).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled) return
        setEnvFields(fields || [])
        setEnvValues({ ...(savedEnv || {}) })
        setInstalled(list.find((i) => i.name === entry.name) || null)
        setUpdate(updates.find((u) => u.name === entry.name) || null)
        setHealth(healthInfo)
        setChangelog({
          versions: change.versions || [],
          homepage: change.homepage,
          latest: change.latest ?? null,
          error: change.error,
          loading: false,
        })
      } catch {
        if (!cancelled) setChangelog((s) => ({ ...s, loading: false }))
      }
    })()
    return () => { cancelled = true }
  }, [entry.name, entry.installed, jobPhase])

  // Reset scroll on agent change so a deep dive doesn't inherit scroll state.
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0 })
  }, [entry.name])

  // Keep the progress card visible once shown, until the user navigates away.
  // Prevents the card from flashing in and out as the store transitions
  // between phases.
  const [progressSticky, setProgressSticky] = useState(false)
  const isBusy = !!job && job.phase !== "done" && job.phase !== "error"
  useEffect(() => { setProgressSticky(false) }, [entry.name])
  useEffect(() => { if (isBusy) setProgressSticky(true) }, [isBusy])
  const showProgress = !!job && job.verb !== "uninstall" && (isBusy || progressSticky)

  const currentVersion = installed?.version || health?.version || null
  const latestVersion = update?.latest || changelog.latest || null
  const installedAtLabel = installed?.installedAt
    ? new Date(installed.installedAt).toLocaleString()
    : entry.installed && !installed ? "External install" : null

  const startInstall = useCallback(async (verb: "install" | "update") => {
    useInstallStore.getState().startJob({ agent: entry.name, verb })
    try {
      // Stage.md §2.5 — when the user picked a non-stable channel, route
      // the install through the version-tag IPC so npm pulls from that
      // dist-tag (`@beta`, `@nightly`). Stable goes through the regular
      // pipeline which already follows `@latest`.
      const tag = channelToDistTag(channel)
      if (tag) {
        await window.api.installAgentTypeAtVersionStreaming(entry.name, tag)
      } else {
        await window.api.installAgentTypeStreaming(entry.name)
      }
      showToast(
        `${entry.label || entry.name} ${verb === "update" ? "updated" : "installed"}${tag ? ` (${tag})` : ""}`,
        "success",
      )
      onAfterInstall(entry)
    } catch (e: unknown) {
      showToast(`${verb} failed: ${(e as Error).message}`, "error")
    }
  }, [entry, channel, onAfterInstall, showToast])

  const startUninstall = useCallback(async () => {
    setConfirmingUninstall(false)
    useInstallStore.getState().startJob({ agent: entry.name, verb: "uninstall" })
    try {
      await window.api.uninstallAgentTypeStreaming(entry.name)
      showToast(`${entry.label || entry.name} uninstalled`, "success")
      onAfterInstall(entry)
    } catch (e: unknown) {
      showToast(`Uninstall failed: ${(e as Error).message}`, "error")
    }
  }, [entry, onAfterInstall, showToast])

  const startRollback = useCallback(async () => {
    if (!installed?.history?.length && !installed?.previousVersion) {
      showToast("No previous version recorded", "warning")
      return
    }
    useInstallStore.getState().startJob({ agent: entry.name, verb: "rollback" })
    try {
      const r = await window.api.rollbackAgentType(entry.name)
      if (r.success) {
        showToast(`Rolled back to v${r.version}`, "success")
        onAfterInstall(entry)
      } else {
        showToast(r.error || "Rollback failed", "error")
      }
    } catch (e: unknown) {
      showToast(`Rollback failed: ${(e as Error).message}`, "error")
    }
  }, [entry, installed, onAfterInstall, showToast])

  const copyLog = useCallback(async () => {
    const text = job?.log || ""
    try {
      await navigator.clipboard.writeText(text)
      showToast("Log copied to clipboard", "success")
    } catch {
      showToast("Failed to copy log", "error")
    }
  }, [job?.log, showToast])

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Button size="sm" variant="ghost" onClick={onBack}>← Back</Button>
      </div>

      {/* Single column. Action buttons live next to the header (top-right)
         rather than in a sticky right rail — keeps the buttons compact and
         lets each section use the full content width. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex-1 min-w-0">
            <AgentHeader
              entry={entry}
              installed={installed}
              currentVersion={currentVersion}
              latestVersion={latestVersion}
              homepage={entry.homepage || changelog.homepage}
              github={entry.github}
              docs={entry.docs}
              installedAtLabel={installedAtLabel}
            />
          </div>
          <div className="md:pt-1 md:max-w-[min(60%,520px)] flex flex-col gap-2 items-stretch md:items-end">
            <AgentInstallActions
              entry={entry}
              installed={installed}
              job={job}
              latestVersion={latestVersion}
              currentVersion={currentVersion}
              onInstall={() => setConfirmingInstall("install")}
              onUpdate={() => setConfirmingInstall("update")}
              onUninstall={() => setConfirmingUninstall(true)}
              onRollback={startRollback}
              onOpenWizard={onOpenWizard ? () => onOpenWizard(entry) : undefined}
            />
            <ChannelSelector value={channel} onChange={setChannel} />
          </div>
        </div>

        {showProgress && job && (
          <StagedProgress
            job={job}
            onCopyLog={copyLog}
            onRetry={job.phase === "error" ? () => startInstall(job.verb === "update" ? "update" : "install") : undefined}
          />
        )}

        {/* 描述 */}
        <AgentReadme entry={entry} />

        {/* 截图 / 演示 */}
        <AgentScreenshots
          screenshots={(entry.screenshots || []).filter(Boolean) as string[]}
          demoUrl={entry.demo_url || entry.demo}
          altPrefix={entry.label || entry.name}
        />

        {/* 系统要求 */}
        <AgentSystemRequirements entry={entry} />

        {/* 依赖项 */}
        <AgentDependencies entry={entry} />

        {/* 环境变量配置 (inline, not modal) */}
        <AgentEnvConfig
          agentName={entry.name}
          fields={envFields}
          values={envValues}
          onChange={setEnvValues}
          showToast={showToast}
        />

        {/* 使用入门指南 */}
        <AgentQuickStart entry={entry} showToast={showToast} />

        {/* 版本信息 */}
        <AgentChangelog
          versions={changelog.versions}
          loading={changelog.loading}
          error={changelog.error}
          homepage={changelog.homepage}
          entry={entry}
          currentVersion={currentVersion}
        />
      </div>

      <InstallConfirmModal
        open={!!confirmingInstall}
        verb={confirmingInstall || "install"}
        entry={entry}
        onConfirm={() => {
          const v = confirmingInstall
          setConfirmingInstall(null)
          if (v) startInstall(v)
        }}
        onCancel={() => setConfirmingInstall(null)}
      />

      <Modal
        open={confirmingUninstall}
        onClose={() => setConfirmingUninstall(false)}
      >
        <div className="flex flex-col items-center" style={{ padding: "8px 0" }}>
          <AgentIcon type={entry.name} size={40} />
          <ModalTitle style={{ marginTop: 12, textAlign: "center" }}>
            Uninstall {entry.label || entry.name}?
          </ModalTitle>
          <p className="hint" style={{ margin: "12px 0 20px", textAlign: "center" }}>
            This will remove <strong>{entry.label || entry.name}</strong> from
            your system. Configured agents of this type may stop working.
          </p>
          <div className="form-actions" style={{ justifyContent: "center", marginTop: 0 }}>
            <Button variant="destructive" onClick={startUninstall}>
              Uninstall
            </Button>
            <Button onClick={() => setConfirmingUninstall(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
