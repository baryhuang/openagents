import React, { useCallback, useEffect, useMemo, useState } from "react"
import ReactDOM from "react-dom"
import {
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Sparkles,
  KeyRound,
  Layers,
  Rocket,
  Cpu,
  Search,
} from "lucide-react"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { PasswordInput } from "../ui/PasswordInput"
import AgentIcon from "../AgentIcon"
import { useAgentsStore } from "../../store/agents"
import type { CatalogEntry, EnvField } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"

const ONBOARDING_KEY = "onboarding_completed"
const STEP_KEY = "onboarding_step"
const SELECTED_AGENT_KEY = "last_selected_agent"

type Step = 0 | 1 | 2 | 3 | 4

type AuthMode = "env" | "login" | "none"

interface AgentConfigState {
  loading: boolean
  fields: EnvField[]
  values: Record<string, string>
  mode: AuthMode
  loginCmd: string | null
  loggedIn: boolean
  docsUrl: string | null
}

const initialConfig: AgentConfigState = {
  loading: false,
  fields: [],
  values: {},
  mode: "none",
  loginCmd: null,
  loggedIn: false,
  docsUrl: null,
}

function hasMissingRequired(config: AgentConfigState): boolean {
  return config.fields.some(
    (f) => f.required && !(config.values[f.name] || "").trim(),
  )
}

export function OnboardingFlow({
  open,
  onClose,
  showToast,
}: {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element | null {
  const [step, setStep] = useState<Step>(() => {
    try {
      const raw = localStorage.getItem(STEP_KEY)
      const n = raw ? Number(raw) : 0
      return ([0, 1, 2, 3, 4].includes(n) ? n : 0) as Step
    } catch {
      return 0
    }
  })
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedAgent, setSelectedAgent] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_AGENT_KEY) || ""
    } catch {
      return ""
    }
  })
  const [installing, setInstalling] = useState(false)
  const [config, setConfig] = useState<AgentConfigState>(initialConfig)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    null | { ok: boolean; detail?: string }
  >(null)
  const [saving, setSaving] = useState(false)
  const [workspaceName, setWorkspaceName] = useState("My Workspace")
  const [creating, setCreating] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchResult, setLaunchResult] = useState<
    null | { ok: boolean; detail?: string }
  >(null)

  useEffect(() => {
    try {
      localStorage.setItem(STEP_KEY, String(step))
    } catch {}
  }, [step])

  useEffect(() => {
    if (selectedAgent) {
      try {
        localStorage.setItem(SELECTED_AGENT_KEY, selectedAgent)
      } catch {}
    }
  }, [selectedAgent])

  useEffect(() => {
    if (!open) return
    if (step !== 1) return
    let cancelled = false
    setCatalogLoading(true)
    window.api
      .getCatalog()
      .then((c) => {
        if (cancelled) return
        setCatalog(c)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, step])

  // Load the selected agent's env_config + check_ready when entering Step 2.
  // Different agents need different fields (Kimi needs API_KEY + BASE_URL +
  // MODEL; Claude only needs CLI login; Codex needs API_KEY + BASE_URL), so
  // we rely on the agent's own manifest rather than a hard-coded provider list.
  //
  // Note: this is first-time onboarding, so we do NOT echo any previously
  // saved values back into the form — the user fills it themselves. The
  // registry's `default` is the only seed (e.g. base URL defaults), and
  // password fields always start empty.
  useEffect(() => {
    if (!open) return
    if (step !== 2) return
    if (!selectedAgent) return
    let cancelled = false
    setConfig({ ...initialConfig, loading: true })
    setTestResult(null)
    Promise.all([
      window.api.getEnvFields(selectedAgent),
      window.api.getCatalog(),
    ])
      .then(([fields, cat]) => {
        if (cancelled) return
        const entry = cat.find((c) => c.name === selectedAgent)
        const docsUrl = entry?.homepage || entry?.docs || null
        const loginCmd = entry?.check_ready?.login_command || null
        if (fields && fields.length > 0) {
          const initialValues: Record<string, string> = {}
          for (const f of fields) {
            // Password fields (API keys) always start empty so the user
            // explicitly enters them. Non-password fields seed from the
            // registry's default (e.g. base URL like https://api.moonshot.ai/v1).
            initialValues[f.name] = f.password ? "" : f.default || ""
          }
          setConfig({
            loading: false,
            fields,
            values: initialValues,
            mode: "env",
            loginCmd,
            loggedIn: false,
            docsUrl,
          })
        } else if (loginCmd) {
          setConfig({
            loading: false,
            fields: [],
            values: {},
            mode: "login",
            loginCmd,
            loggedIn: false,
            docsUrl,
          })
          window.api
            .healthCheck(selectedAgent)
            .then((h) => {
              if (cancelled) return
              setConfig((prev) => ({ ...prev, loggedIn: !!h?.ready }))
            })
            .catch(() => {})
        } else {
          setConfig({
            loading: false,
            fields: [],
            values: {},
            mode: "none",
            loginCmd: null,
            loggedIn: true,
            docsUrl,
          })
        }
      })
      .catch(() => {
        if (cancelled) return
        setConfig({ ...initialConfig, loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [open, step, selectedAgent])

  const finishedAgentName = useMemo(() => `${selectedAgent}-1`, [selectedAgent])

  const close = useCallback(
    (markComplete = false) => {
      if (markComplete) {
        try {
          localStorage.setItem(ONBOARDING_KEY, "true")
          localStorage.removeItem(STEP_KEY)
        } catch {}
      }
      onClose()
    },
    [onClose],
  )

  const goNext = (): void => setStep((s) => (Math.min(s + 1, 4) as Step))
  const goBack = (): void => setStep((s) => (Math.max(s - 1, 0) as Step))

  const updateConfigValue = (name: string, value: string): void => {
    setConfig((prev) => ({ ...prev, values: { ...prev.values, [name]: value } }))
    setTestResult(null)
  }

  const testEnvConnection = async (): Promise<void> => {
    if (config.fields.length === 0) return
    if (hasMissingRequired(config)) {
      showToast("Fill in the required fields first", "warning")
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.testLLM(config.values)
      if (r.success) {
        setTestResult({
          ok: true,
          detail: r.model ? `${r.model} responded` : "Connection looks good",
        })
      } else {
        setTestResult({ ok: false, detail: r.error || "Test failed" })
      }
    } catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const openLoginTerminal = async (): Promise<void> => {
    if (!config.loginCmd) return
    try {
      await window.api.openTerminal(config.loginCmd)
      showToast("Login terminal opened. Complete login there.", "success")
      // Re-check health a few times after the terminal opens so the UI updates
      // once the user finishes the CLI login.
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          const h = await window.api.healthCheck(selectedAgent)
          if (h?.ready) {
            setConfig((prev) => ({ ...prev, loggedIn: true }))
            return
          }
        } catch {}
      }
    } catch (e) {
      showToast((e as Error).message, "error")
    }
  }

  const saveConfigAndContinue = async (): Promise<void> => {
    if (config.mode === "env") {
      if (hasMissingRequired(config)) {
        showToast("Fill in the required fields first", "warning")
        return
      }
      setSaving(true)
      try {
        await window.api.saveAgentEnv(selectedAgent, config.values)
        goNext()
      } catch (e) {
        showToast((e as Error).message, "error")
      } finally {
        setSaving(false)
      }
      return
    }
    // login mode → require the CLI login to have succeeded before advancing.
    if (config.mode === "login" && !config.loggedIn) {
      showToast("Complete the CLI login before continuing", "warning")
      return
    }
    goNext()
  }

  const createWorkspaceAndContinue = async (): Promise<void> => {
    const name = workspaceName.trim()
    if (!name) {
      showToast("Enter a workspace name", "warning")
      return
    }
    setCreating(true)
    try {
      // 1. Create the workspace on workspace.openagents.org. We let errors
      //    surface so the user knows if creation actually failed — the prior
      //    silent-catch implementation lied about success and left the
      //    Workspaces tab empty.
      const ws = await window.api.createWorkspace(name)

      // 2. Create the agent instance. addAgent throws "already exists" if
      //    the user re-runs onboarding with the same agent name — the
      //    renderer catches it, but Electron's IPC handler still logs the
      //    error to the main-process console. Pre-checking via listAgents
      //    avoids the noisy log.
      const existingAgents = await window.api.listAgents()
      const alreadyExists = existingAgents.some(
        (a) => a.name === finishedAgentName,
      )
      if (!alreadyExists) {
        try {
          await window.api.addAgent({
            name: finishedAgentName,
            type: selectedAgent,
          })
        } catch {
          // Last-resort guard for a race (another window adding the same
          // agent between the check and the add).
        }
      }

      // 3. Bind the agent to the new workspace via its join token. This is
      //    what registers the workspace in the launcher's local network
      //    list — without it, listWorkspaces() returns nothing and the
      //    Workspaces tab stays empty even though the workspace exists
      //    server-side.
      if (ws && ws.token) {
        try {
          await window.api.connectWorkspace(finishedAgentName, ws.token)
          window.api.signalReload()
        } catch (e) {
          showToast(
            `Workspace created, but binding the agent failed: ${(e as Error).message}`,
            "warning",
          )
        }
      }

      await window.api
        .listAgents()
        .then((a) => useAgentsStore.getState().setAgents(a))
      showToast(`Workspace "${name}" created`, "success")
      goNext()
    } catch (e) {
      showToast(`Failed to create workspace: ${(e as Error).message}`, "error")
    } finally {
      setCreating(false)
    }
  }

  const launchAgent = async (): Promise<void> => {
    setLaunching(true)
    setLaunchResult(null)
    try {
      await window.api.startAgent(finishedAgentName)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const status = await window.api.agentStatus()
        const a = status[finishedAgentName]
        if (a && ["running", "online", "idle"].includes(a.state)) {
          setLaunchResult({ ok: true })
          return
        }
        if (a && a.state === "error") {
          setLaunchResult({ ok: false, detail: a.last_error || "Agent errored" })
          return
        }
      }
      setLaunchResult({ ok: true, detail: "Started — still warming up." })
    } catch (e) {
      setLaunchResult({ ok: false, detail: (e as Error).message })
    } finally {
      setLaunching(false)
    }
  }

  const installSelectedAgent = async (): Promise<void> => {
    if (!selectedAgent) return
    const entry = catalog.find((c) => c.name === selectedAgent)
    if (entry?.installed) {
      goNext()
      return
    }
    setInstalling(true)
    try {
      await window.api.installAgentTypeStreaming(selectedAgent)
      const next = await window.api.getCatalog()
      setCatalog(next)
      goNext()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setInstalling(false)
    }
  }

  if (!open) return null

  const visibleCatalog = (() => {
    const q = search.trim().toLowerCase()
    let list = catalog.slice().sort((a, b) => {
      if ((b.featured ? 1 : 0) !== (a.featured ? 1 : 0))
        return (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
      return (a.order ?? 99) - (b.order ?? 99)
    })
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.label || "").toLowerCase().includes(q) ||
          (c.description || "").toLowerCase().includes(q) ||
          (c.tags || []).some((t) => t.toLowerCase().includes(q)),
      )
    }
    return list
  })()

  const renderBody = (): React.JSX.Element | null => {
    switch (step) {
      case 0:
        return <WelcomeStep />
      case 1:
        return (
          <AgentSelectionStep
            catalog={visibleCatalog}
            loading={catalogLoading}
            search={search}
            setSearch={setSearch}
            selected={selectedAgent}
            setSelected={setSelectedAgent}
          />
        )
      case 2:
        return (
          <ApiKeyStep
            agentLabel={
              catalog.find((c) => c.name === selectedAgent)?.label ||
              selectedAgent
            }
            config={config}
            onChangeValue={updateConfigValue}
            onTest={testEnvConnection}
            onLogin={openLoginTerminal}
            testing={testing}
            testResult={testResult}
          />
        )
      case 3:
        return <WorkspaceStep name={workspaceName} setName={setWorkspaceName} />
      case 4:
        return (
          <LaunchStep
            agentName={finishedAgentName}
            launching={launching}
            result={launchResult}
          />
        )
      default:
        return null
    }
  }

  const renderFooter = (): React.JSX.Element => {
    switch (step) {
      case 0:
        return (
          <FooterShell>
            <span />
            <Button variant="primary" onClick={goNext}>
              Get started <ChevronRight className="w-4 h-4" />
            </Button>
          </FooterShell>
        )
      case 1:
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            <Button
              variant="primary"
              onClick={installSelectedAgent}
              disabled={!selectedAgent || installing}
            >
              {installing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Installing…
                </>
              ) : (
                <>
                  Continue <ChevronRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </FooterShell>
        )
      case 2: {
        const cantContinue =
          config.loading ||
          saving ||
          (config.mode === "env" && hasMissingRequired(config)) ||
          (config.mode === "login" && !config.loggedIn)
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            <Button
              variant="primary"
              onClick={saveConfigAndContinue}
              disabled={cantContinue}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  Save & continue <ChevronRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </FooterShell>
        )
      }
      case 3:
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            <Button
              variant="primary"
              onClick={createWorkspaceAndContinue}
              disabled={creating || !workspaceName.trim()}
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  Create <ChevronRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </FooterShell>
        )
      case 4:
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            {launchResult?.ok ? (
              <Button variant="primary" onClick={() => close(true)}>
                Go to Dashboard <ChevronRight className="w-4 h-4" />
              </Button>
            ) : launchResult ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => close(true)}>
                  Finish anyway
                </Button>
                <Button
                  variant="primary"
                  onClick={launchAgent}
                  disabled={launching}
                >
                  {launching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Launching…
                    </>
                  ) : (
                    "Retry launch"
                  )}
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={launchAgent}
                disabled={launching}
              >
                {launching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Launching…
                  </>
                ) : (
                  "Launch agent"
                )}
              </Button>
            )}
          </FooterShell>
        )
      default:
        return <FooterShell />
    }
  }

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-1500 flex flex-col bg-(--bg-primary)">
      <ProgressBar step={step} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full max-w-180 mx-auto px-8 py-10 sm:py-12">
          {renderBody()}
        </div>
      </div>

      {renderFooter()}
    </div>,
    document.body,
  )
}

// ─── Layout shells ────────────────────────────────────────────

function ProgressBar({ step }: { step: Step }): React.JSX.Element {
  const labels = ["Welcome", "Agent", "API key", "Workspace", "Launch"]
  return (
    <div className="shrink-0 px-8 pt-6 pb-4 border-b border-(--border) bg-(--bg-card)">
      <div className="flex items-center gap-3 max-w-180 mx-auto">
        {labels.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center",
                  i < step
                    ? "bg-(--success) text-white"
                    : i === step
                      ? "bg-(--accent) text-white"
                      : "bg-(--bg-input) text-(--text-tertiary)",
                )}
              >
                {i < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-[12px]",
                  i === step
                    ? "text-(--text-primary) font-semibold"
                    : "text-(--text-secondary)",
                )}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div className="flex-1 h-px bg-(--border)" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function FooterShell({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="shrink-0 border-t border-(--border) bg-(--bg-card) px-8 py-4">
      <div className="max-w-180 mx-auto flex items-center justify-between gap-3">
        {children}
      </div>
    </div>
  )
}

function StepHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.JSX.Element
  title: string
  subtitle: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 mb-8">
      <div className="w-10 h-10 rounded-(--radius-sm) bg-(--accent-bg) text-(--accent) flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold m-0 tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-1 m-0 text-[13px] text-(--text-secondary)">
          {subtitle}
        </p>
      </div>
    </div>
  )
}

// ─── Step bodies ──────────────────────────────────────────────

function WelcomeStep(): React.JSX.Element {
  return (
    <>
      <StepHeader
        icon={<Sparkles className="w-5 h-5" />}
        title="Welcome to OpenAgents Launcher"
        subtitle="Run, configure, and orchestrate AI coding agents from one place."
      />
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 list-none m-0 p-0">
        {[
          { icon: <Cpu className="w-4 h-4" />, label: "Install agents (Claude, Codex, OpenCode, Hermes…)" },
          { icon: <KeyRound className="w-4 h-4" />, label: "Manage API keys and credentials in one encrypted store" },
          { icon: <Layers className="w-4 h-4" />, label: "Spin up workspaces and chat with running agents" },
          { icon: <Rocket className="w-4 h-4" />, label: "Connect to GitHub, Slack, Discord, Linear and more" },
        ].map((b) => (
          <li
            key={b.label}
            className="flex items-start gap-3 p-3.5 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)"
          >
            <div className="text-(--accent) mt-0.5 shrink-0">{b.icon}</div>
            <span className="text-[12px] text-(--text-primary)">{b.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-[12px] text-(--text-tertiary)">
        We'll have you running your first agent in under two minutes.
      </p>
    </>
  )
}

function AgentSelectionStep({
  catalog,
  loading,
  search,
  setSearch,
  selected,
  setSelected,
}: {
  catalog: CatalogEntry[]
  loading: boolean
  search: string
  setSearch: (v: string) => void
  selected: string
  setSelected: (v: string) => void
}): React.JSX.Element {
  return (
    <>
      <StepHeader
        icon={<Cpu className="w-5 h-5" />}
        title="Pick your first agent"
        subtitle="You can install more later from the Install tab."
      />
      <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
        <Search className="w-3.5 h-3.5 text-(--text-tertiary)" />
        <input
          className="flex-1 bg-transparent border-0 outline-none text-[13px]"
          placeholder="Search agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-2.5 list-none m-0 p-0">
        {loading && (
          <li className="col-span-1 sm:col-span-2 text-center text-[12px] text-(--text-tertiary) py-6">
            Loading catalog…
          </li>
        )}
        {!loading && catalog.length === 0 && (
          <li className="col-span-1 sm:col-span-2 text-center text-[12px] text-(--text-tertiary) py-6">
            No agents match.
          </li>
        )}
        {!loading &&
          catalog.map((c) => {
            const active = c.name === selected
            return (
              <li key={c.name} className="h-full">
                <button
                  type="button"
                  onClick={() => setSelected(c.name)}
                  className={cn(
                    "w-full h-full text-left p-3 rounded-(--radius-sm) border bg-(--bg-card) cursor-pointer transition-colors",
                    active
                      ? "border-(--accent) ring-2 ring-(--accent-border)"
                      : "border-(--border) hover:border-(--border-hover)",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <AgentIcon type={c.name} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-(--text-primary) truncate">
                          {c.label || c.name}
                        </span>
                        {c.featured && (
                          <span className="text-[9px] uppercase px-1 py-0.5 rounded-sm bg-(--accent-bg) text-(--accent) font-bold">
                            Featured
                          </span>
                        )}
                        {c.installed && (
                          <span className="text-[9px] uppercase px-1 py-0.5 rounded-sm bg-(--success-bg) text-(--success-text) font-bold">
                            Installed
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] leading-snug text-(--text-secondary) line-clamp-2 mt-1 min-h-[2lh]">
                        {c.description || "—"}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
      </ul>
    </>
  )
}

function ApiKeyStep({
  agentLabel,
  config,
  onChangeValue,
  onTest,
  onLogin,
  testing,
  testResult,
}: {
  agentLabel: string
  config: AgentConfigState
  onChangeValue: (name: string, value: string) => void
  onTest: () => void
  onLogin: () => void
  testing: boolean
  testResult: null | { ok: boolean; detail?: string }
}): React.JSX.Element {
  const subtitle =
    config.mode === "login"
      ? `${agentLabel} uses CLI login — we'll open a terminal so you can authenticate.`
      : config.mode === "none"
        ? `${agentLabel} doesn't need any environment configuration.`
        : `Configure ${agentLabel}. Saved to ~/.openagents/env/ and wired into the agent's .env automatically.`

  return (
    <>
      <StepHeader
        icon={<KeyRound className="w-5 h-5" />}
        title="Configure agent"
        subtitle={subtitle}
      />

      {config.loading ? (
        <div className="flex items-center gap-2 text-[12px] text-(--text-tertiary) py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading configuration…
        </div>
      ) : config.mode === "env" ? (
        <>
          <div className="flex flex-col gap-4">
            {config.fields.map((f) => {
              const FieldInput = f.password ? PasswordInput : Input
              const value = config.values[f.name] ?? ""
              return (
                <div key={f.name}>
                  <label className="block text-[12px] font-medium mb-1.5">
                    {f.description || f.name}
                    {f.required && <span className="text-(--danger-text) ml-0.5">*</span>}
                    <span className="ml-2 text-[10px] text-(--text-tertiary) font-mono">
                      {f.name}
                    </span>
                  </label>
                  <FieldInput
                    value={value}
                    onChange={(e) => onChangeValue(f.name, e.target.value)}
                    placeholder={f.placeholder || f.default || `Enter ${f.name}…`}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <Button size="sm" onClick={onTest} disabled={testing}>
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…
                </>
              ) : (
                "Test connection"
              )}
            </Button>
            {config.docsUrl && (
              <a
                href={config.docsUrl}
                onClick={(e) => {
                  e.preventDefault()
                  if (config.docsUrl) window.api.openExternal(config.docsUrl)
                }}
                className="text-[12px] text-(--accent) hover:underline"
              >
                Where do I get a key?
              </a>
            )}
          </div>
        </>
      ) : config.mode === "login" ? (
        <div className="p-4 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
          <div className="flex items-center gap-2 text-[13px] mb-3">
            <span>{config.loggedIn ? "✅" : "⚠️"}</span>
            <strong>
              {config.loggedIn ? "Logged in" : "Not logged in"}
            </strong>
          </div>
          <p className="text-[12px] text-(--text-secondary) m-0 mb-3">
            Click below to open a terminal and run{" "}
            <code className="inline-code">{config.loginCmd}</code>. Once you
            complete the login, this page will update automatically.
          </p>
          <Button size="sm" variant="primary" onClick={onLogin}>
            {config.loggedIn ? "Re-login" : "Open login terminal"}
          </Button>
        </div>
      ) : (
        <div className="p-4 rounded-(--radius-sm) bg-(--success-bg) text-(--success-text) text-[12px]">
          No configuration needed. Click <strong>Save & continue</strong> to
          move on.
        </div>
      )}

      {testResult && (
        <div
          className={cn(
            "mt-4 px-3 py-2 rounded-sm text-[12px]",
            testResult.ok
              ? "bg-(--success-bg) text-(--success-text)"
              : "bg-(--danger-bg) text-(--danger-text)",
          )}
        >
          {testResult.ok ? "✓ Connected" : "✗ Failed"}
          {testResult.detail && (
            <span className="ml-1.5 opacity-80">— {testResult.detail}</span>
          )}
        </div>
      )}
    </>
  )
}

function WorkspaceStep({
  name,
  setName,
}: {
  name: string
  setName: (v: string) => void
}): React.JSX.Element {
  return (
    <>
      <StepHeader
        icon={<Layers className="w-5 h-5" />}
        title="Create a workspace"
        subtitle="A workspace is where agents collaborate. You can connect more later."
      />
      <label className="block text-[12px] font-medium mb-1.5">
        Workspace name
      </label>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="My Workspace"
      />
      <p className="mt-3 text-[11px] text-(--text-tertiary)">
        We'll create a new workspace at <code className="inline-code">workspace.openagents.org</code> and
        register your first agent against it.
      </p>
    </>
  )
}

function LaunchStep({
  agentName,
  launching,
  result,
}: {
  agentName: string
  launching: boolean
  result: null | { ok: boolean; detail?: string }
}): React.JSX.Element {
  return (
    <>
      <StepHeader
        icon={<Rocket className="w-5 h-5" />}
        title="Launch your agent"
        subtitle={`Start ${agentName} and verify it reaches a healthy state.`}
      />
      <div className="p-4 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
        <div className="flex items-center gap-2 text-[12px]">
          <Cpu className="w-4 h-4 text-(--accent)" />
          <span className="font-medium">{agentName}</span>
        </div>
        {result && (
          <div
            className={cn(
              "mt-3 px-3 py-2 rounded-sm text-[12px]",
              result.ok
                ? "bg-(--success-bg) text-(--success-text)"
                : "bg-(--danger-bg) text-(--danger-text)",
            )}
          >
            {result.ok ? "Agent is healthy and running" : "Agent did not start"}
            {result.detail && (
              <span className="ml-1.5 opacity-80">— {result.detail}</span>
            )}
          </div>
        )}
        {!result && !launching && (
          <p className="mt-3 text-[12px] text-(--text-secondary) m-0">
            Click <strong>Launch agent</strong> below to start it now.
          </p>
        )}
      </div>
    </>
  )
}

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== "true"
  } catch {
    return false
  }
}
