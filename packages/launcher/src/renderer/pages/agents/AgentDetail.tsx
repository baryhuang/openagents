import React, { useEffect, useState } from "react"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { PasswordInput } from "../../components/ui/PasswordInput"
import { Badge } from "../../components/ui/Badge"
import { Modal, ModalTitle } from "../../components/ui/Modal"
import AgentIcon from "../../components/AgentIcon"
import { PhaseBar } from "../../components/InstallProgress"
import { useInstallStore } from "../../store/install"
import type { CatalogEntry, EnvField, AgentUpdateInfo, InstalledAgentRecord, HealthCheck } from "../../types"
import type { ToastType } from "../../hooks/useToast"

const SECTION = "px-4.5 py-4 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm"
const SECTION_H4 = "text-xs font-semibold uppercase tracking-wider text-(--text-secondary) m-0 mb-2.5"
const DL = "grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1.5 m-0 text-xs [&>dt]:text-(--text-tertiary) [&>dd]:m-0 [&>dd]:text-(--text-primary) [&>dd]:wrap-break-word"

interface AgentDetailProps {
  entry: CatalogEntry
  onBack: () => void
  onAfterInstall: (entry: CatalogEntry) => void
  onOpenWizard?: (entry: CatalogEntry) => void
  showToast: (message: string, type?: ToastType) => void
}

interface ChangelogState {
  versions: Array<{ version: string; date?: string }>
  homepage?: string
  error?: string
  loading: boolean
}

export default function AgentDetail({
  entry,
  onBack,
  onAfterInstall,
  onOpenWizard,
  showToast,
}: AgentDetailProps): React.JSX.Element {
  const [envFields, setEnvFields] = useState<EnvField[]>([])
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [savingEnv, setSavingEnv] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [changelog, setChangelog] = useState<ChangelogState>({ versions: [], loading: true })
  const [installed, setInstalled] = useState<InstalledAgentRecord | null>(null)
  const [update, setUpdate] = useState<AgentUpdateInfo | null>(null)
  const [health, setHealth] = useState<HealthCheck | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)

  const job = useInstallStore((s) => s.jobs[entry.name])

  // Re-fetch when a job for this agent reaches a terminal state so the
  // header / version / rollback availability reflect the new install record.
  const jobPhase = job?.phase
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [fields, typeSaved, list, updates, change, healthInfo] = await Promise.all([
          window.api.getEnvFields(entry.name).catch(() => [] as EnvField[]),
          window.api.getAgentEnv(entry.name).catch(() => ({}) as Record<string, string>),
          window.api.getInstalledAgents().catch(() => []),
          window.api.checkAgentUpdates().catch(() => []),
          window.api.getAgentChangelog(entry.name).catch(() => ({ versions: [], homepage: undefined, error: undefined } as { versions: Array<{ version: string; date?: string }>; homepage?: string; error?: string })),
          entry.installed ? window.api.healthCheck(entry.name).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled) return
        setEnvFields(fields || [])
        setEnvValues({ ...(typeSaved || {}) })
        setInstalled(list.find((i) => i.name === entry.name) || null)
        setUpdate(updates.find((u) => u.name === entry.name) || null)
        setHealth(healthInfo)
        setChangelog({ versions: change.versions || [], homepage: change.homepage, error: change.error, loading: false })
      } catch {
        if (!cancelled) setChangelog((s) => ({ ...s, loading: false }))
      }
    })()
    return () => { cancelled = true }
  }, [entry.name, entry.installed, jobPhase])

  // Reset scroll on entry change so deep dives don't inherit a previous scroll.
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0 })
  }, [entry.name])

  const isInstalled = entry.installed
  const isManaged = entry.managed !== false
  const isInstalling = !!job && job.phase !== "done" && job.phase !== "error"

  async function saveEnv(): Promise<void> {
    setSavingEnv(true)
    try {
      await window.api.saveAgentEnv(entry.name, envValues)
      showToast("Configuration saved", "success")
    } catch (e: unknown) {
      showToast(`Error: ${(e as Error).message}`, "error")
    } finally {
      setSavingEnv(false)
    }
  }

  async function testConnection(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.testLLM(envValues)
      if (r.success) setTestResult({ ok: true, message: `OK — ${r.model || ""} responded` })
      else setTestResult({ ok: false, message: r.error || "Test failed" })
    } catch (e: unknown) {
      setTestResult({ ok: false, message: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function startInstall(): Promise<void> {
    const verb = isInstalled ? "update" : "install"
    useInstallStore.getState().startJob({ agent: entry.name, verb })
    try {
      await window.api.installAgentTypeStreaming(entry.name)
      showToast(`${entry.label || entry.name} ${verb === "update" ? "updated" : "installed"}`, "success")
      onAfterInstall(entry)
    } catch (e: unknown) {
      showToast(`${verb} failed: ${(e as Error).message}`, "error")
    }
  }

  async function startUninstall(): Promise<void> {
    setConfirmingUninstall(false)
    useInstallStore.getState().startJob({ agent: entry.name, verb: "uninstall" })
    try {
      await window.api.uninstallAgentTypeStreaming(entry.name)
      showToast(`${entry.label || entry.name} uninstalled`, "success")
      onAfterInstall(entry)
    } catch (e: unknown) {
      showToast(`Uninstall failed: ${(e as Error).message}`, "error")
    }
  }

  async function startRollback(): Promise<void> {
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
  }

  const reqs = (entry.install?.requires || []).filter((x): x is string => !!x)
  const homepage = entry.homepage || changelog.homepage
  const screenshots = (entry.screenshots || []).filter(Boolean)
  const demoUrl = entry.demo_url || entry.demo
  // Current version: tracked record → live `binary --version` from healthCheck.
  // Latest version: tracked update info → first changelog entry from npm.
  const currentVersion = installed?.version || health?.version || null
  const latestVersion = update?.latest || changelog.versions[0]?.version || null
  const installedAtLabel = installed?.installedAt
    ? new Date(installed.installedAt).toLocaleString()
    : (entry.installed && !installed ? "External install" : null)
  const hasUpdate = !!(currentVersion && latestVersion && currentVersion !== latestVersion)
  const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : ""
  const platformKey: "macos" | "linux" | "windows" =
    ua.includes("win") ? "windows" : ua.includes("mac") ? "macos" : "linux"
  const platformInstallCmd = entry.install?.[platformKey]
  const platforms = [
    entry.install?.macos && "macOS",
    entry.install?.linux && "Linux",
    entry.install?.windows && "Windows",
  ].filter(Boolean) as string[]

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Button size="sm" variant="ghost" onClick={onBack}>← Back</Button>
      </div>

      <div className="flex items-start gap-4 pt-1 pb-3 border-b border-(--border)">
        <AgentIcon type={entry.name} size={56} />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold tracking-tight m-0 mb-1">
            {entry.label || entry.name}{" "}
            {entry.featured && <span className="text-[11px] text-(--accent)" title="Featured">★</span>}
          </h2>
          <p className="text-[13px] text-(--text-secondary) leading-snug m-0 mb-2">{entry.description || "No description available"}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {isInstalled ? (
              isManaged
                ? <Badge variant="success">Installed</Badge>
                : <Badge variant="info">Global</Badge>
            ) : (
              <Badge variant="warning">Not installed</Badge>
            )}
            {hasUpdate && <Badge variant="warning">Update v{latestVersion} available</Badge>}
            {installed?.version && <span className="text-[11px] text-(--text-tertiary)">v{installed.version}</span>}
            {homepage && (
              <a
                href="#"
                className="text-[11px]"
                onClick={(e) => { e.preventDefault(); window.api.openExternal(homepage) }}
              >
                {homepage.replace(/^https?:\/\//, "")} ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 items-stretch shrink-0 min-w-30 [&>button]:w-full [&>button]:justify-center">
          {!isInstalled && (
            <Button size="sm" variant="primary" onClick={startInstall} disabled={isInstalling}>
              {isInstalling ? "Installing…" : "Install"}
            </Button>
          )}
          {isInstalled && isManaged && (
            <>
              <Button size="sm" variant="primary" onClick={startInstall} disabled={isInstalling}>
                {hasUpdate ? `Update to v${latestVersion}` : "Update"}
              </Button>
              {onOpenWizard && (
                <Button size="sm" onClick={() => onOpenWizard(entry)} disabled={isInstalling}>
                  Setup wizard
                </Button>
              )}
              {(installed?.history?.length || installed?.previousVersion) && (
                <Button size="sm" onClick={startRollback} disabled={isInstalling}>
                  Roll back
                </Button>
              )}
              <Button size="sm" variant="destructive" onClick={() => setConfirmingUninstall(true)} disabled={isInstalling}>
                Uninstall
              </Button>
            </>
          )}
        </div>
      </div>

      {job && job.verb !== "uninstall" && job.verb !== "rollback" && isInstalling && (
        <div className={SECTION}>
          <h4 className={SECTION_H4}>{job.verb === "update" ? "Update progress" : "Install progress"}</h4>
          <PhaseBar phase={job.phase} detail={job.detail} errored={job.phase === "error"} />
          <div className="flex items-center justify-between mt-3">
            <span className="text-[11px] text-(--text-tertiary)">{job.detail || job.phase}</span>
            <Button size="sm" variant="ghost" onClick={() => setShowLog((v) => !v)}>
              {showLog ? "Hide log" : "View log"}
            </Button>
          </div>
          {showLog && (
            <pre className="log-viewer mt-3" style={{ maxHeight: 240 }}>{job.log}</pre>
          )}
        </div>
      )}

      <div className={SECTION}>
        <h4 className={SECTION_H4}>Overview</h4>
        {entry.long_description ? (
          <p className="text-xs text-(--text-secondary) leading-[1.7] m-0 mb-3 whitespace-pre-wrap">
            {entry.long_description}
          </p>
        ) : (
          <p className="text-xs text-(--text-secondary) leading-[1.7] m-0 mb-3">
            {entry.description || "No description available for this agent yet."}
          </p>
        )}
        {screenshots.length > 0 ? (
          <div className="flex gap-2.5 overflow-x-auto pb-1.5">
            {screenshots.map((src, i) => (
              <a
                key={`${src}-${i}`}
                href="#"
                onClick={(e) => { e.preventDefault(); window.api.openExternal(src) }}
                className="flex-none block border border-(--border) rounded-lg overflow-hidden bg-(--bg-input) transition-all duration-150 hover:border-(--accent) hover:-translate-y-px"
                title="Open full size"
              >
                <img
                  src={src}
                  alt={`${entry.label || entry.name} screenshot ${i + 1}`}
                  loading="lazy"
                  className="block h-35 w-auto max-w-65 object-cover"
                />
              </a>
            ))}
          </div>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            No screenshots provided.
            {homepage && <> See <a href="#" onClick={(e) => { e.preventDefault(); window.api.openExternal(homepage) }}>the project homepage</a> for visuals.</>}
          </p>
        )}
        <div className="mt-3">
          {demoUrl ? (
            <Button size="sm" onClick={() => window.api.openExternal(demoUrl)}>
              Watch demo ↗
            </Button>
          ) : homepage ? (
            <Button size="sm" variant="ghost" onClick={() => window.api.openExternal(homepage)}>
              Open homepage ↗
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[920px]:grid-cols-[1.5fr_1fr]">
        <div className={SECTION}>
          <h4 className={SECTION_H4}>System requirements</h4>
          <dl className={DL}>
            <dt>Platforms</dt>
            <dd>{platforms.length > 0 ? platforms.join(", ") : "Any"}</dd>
            <dt>Mode</dt>
            <dd>{entry.install?.api_only ? "Direct API (no binary)" : "Binary install"}</dd>
            {entry.install?.binary && (
              <>
                <dt>Binary</dt>
                <dd><code className="inline-code">{entry.install.binary}</code></dd>
              </>
            )}
            {platformInstallCmd && (
              <>
                <dt>Install command</dt>
                <dd><code className="inline-code">{platformInstallCmd}</code></dd>
              </>
            )}
            {entry.check_ready?.login_command && (
              <>
                <dt>Login command</dt>
                <dd><code className="inline-code">{entry.check_ready.login_command}</code></dd>
              </>
            )}
          </dl>
        </div>

        <div className={SECTION}>
          <h4 className={SECTION_H4}>Version</h4>
          <dl className={DL}>
            <dt>Current</dt>
            <dd>{currentVersion ? `v${currentVersion}` : entry.installed ? "Installed (version unknown)" : "Not installed"}</dd>
            <dt>Latest</dt>
            <dd>{latestVersion ? `v${latestVersion}` : changelog.loading ? "Checking…" : "Unavailable"}</dd>
            {installed?.previousVersion && (
              <>
                <dt>Previous</dt>
                <dd>v{installed.previousVersion}</dd>
              </>
            )}
            {installedAtLabel && (
              <>
                <dt>Installed</dt>
                <dd>{installedAtLabel}</dd>
              </>
            )}
            {health?.binary && (
              <>
                <dt>Location</dt>
                <dd><code className="inline-code">{health.binary}</code></dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <div className={SECTION}>
        <h4 className={SECTION_H4}>Dependencies</h4>
        {reqs.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>This agent has no external dependencies.</p>
        ) : (
          <ul className="list-none p-0 m-0 flex flex-col gap-2">
            {reqs.map((dep) => (
              <li
                key={dep}
                className="flex items-baseline justify-between gap-3 px-2.5 py-2 bg-(--bg-input) rounded-md"
              >
                <span className="text-xs font-semibold font-mono text-(--text-primary)">{dep}</span>
                <span className="hint" style={{ margin: 0 }}>
                  {dep === "nodejs" ? "Node.js runtime" :
                   dep === "git" ? "Git version control" :
                   dep === "python" ? "Python interpreter" :
                   "Required by this agent"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={SECTION}>
        <h4 className={SECTION_H4}>Configuration</h4>
        {envFields.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            This agent does not expose environment variables.
            {entry.check_ready?.login_command && (
              <> Authenticate via <code className="inline-code">{entry.check_ready.login_command}</code> instead.</>
            )}
          </p>
        ) : (
          <>
            <p className="hint" style={{ margin: "0 0 12px" }}>Environment variables saved to <code className="inline-code">~/.openagents/env/</code>.</p>
            {envFields.map((f) => {
              const FieldInput = f.password ? PasswordInput : Input
              return (
                <div className="form-group" key={f.name}>
                  <label>
                    {f.description || f.name}
                    {f.required && <span className="required"> *</span>}
                  </label>
                  <FieldInput
                    value={envValues[f.name] ?? f.default ?? ""}
                    onChange={(e) => setEnvValues({ ...envValues, [f.name]: e.target.value })}
                    placeholder={f.placeholder || `Enter ${f.name}…`}
                  />
                </div>
              )
            })}
            {testResult && (
              <p className={testResult.ok ? "test-success" : "test-error"} style={{ fontSize: 12, marginBottom: 8 }}>
                {testResult.message}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={saveEnv} disabled={savingEnv}>
                {savingEnv ? "Saving…" : "Save"}
              </Button>
              <Button onClick={testConnection} disabled={testing}>
                {testing ? "Testing…" : "Test connection"}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className={SECTION}>
        <h4 className={SECTION_H4}>Getting started</h4>
        <ol className="text-xs pl-4 leading-[1.7] text-(--text-secondary) list-decimal">
          <li>Install {entry.label || entry.name} from this page.</li>
          {envFields.length > 0 && <li>Configure required environment variables (API keys, model name).</li>}
          {entry.check_ready?.login_command && (
            <li>
              Run <code className="inline-code">{entry.check_ready.login_command}</code> to authenticate the CLI.
            </li>
          )}
          <li>Go to the <strong>Agents</strong> tab and create a new agent instance of this type.</li>
          <li>Start the agent, then open its workspace.</li>
        </ol>
      </div>

      <div className={SECTION}>
        <h4 className={SECTION_H4}>Changelog</h4>
        {changelog.loading ? (
          <span className="loading-text">Loading…</span>
        ) : changelog.error ? (
          <p className="hint" style={{ margin: 0 }}>Changelog unavailable: {changelog.error}</p>
        ) : changelog.versions.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>No changelog data.</p>
        ) : (
          <ul className="text-xs m-0 pl-0 list-none">
            {changelog.versions.map((v) => (
              <li key={v.version} className="flex justify-between py-1 border-b border-(--border) last:border-b-0">
                <span className="font-medium">v{v.version}</span>
                <span className="text-(--text-tertiary)">{v.date ? new Date(v.date).toLocaleDateString() : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={confirmingUninstall} onClose={() => setConfirmingUninstall(false)}>
        <div className="flex flex-col items-center" style={{ padding: "8px 0" }}>
          <AgentIcon type={entry.name} size={40} />
          <ModalTitle style={{ marginTop: 12, textAlign: "center" }}>
            Uninstall {entry.label || entry.name}?
          </ModalTitle>
          <p className="hint" style={{ margin: "12px 0 20px", textAlign: "center" }}>
            This will remove <strong>{entry.label || entry.name}</strong> from your system. Configured agents of this type may stop working.
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
