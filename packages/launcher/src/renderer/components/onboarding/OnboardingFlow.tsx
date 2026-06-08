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
  AlertTriangle,
} from "lucide-react"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { PasswordInput } from "../ui/PasswordInput"
import AgentIcon from "../AgentIcon"
import { useAgentsStore } from "../../store/agents"
import type { OnboardingAgent, EnvField } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"
import { capture } from "../../lib/analytics"

const ONBOARDING_KEY = "onboarding_completed"
const STEP_KEY = "onboarding_step"
const SELECTED_AGENT_KEY = "last_selected_agent"

type Step = 0 | 1 | 2 | 3 | 4

const isWindows =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)

function hasMissingRequired(
  fields: EnvField[],
  values: Record<string, string>,
): boolean {
  return fields.some((f) => f.required && !(values[f.name] || "").trim())
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
  const [agents, setAgents] = useState<OnboardingAgent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedAgent, setSelectedAgent] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_AGENT_KEY) || ""
    } catch {
      return ""
    }
  })
  const [installing, setInstalling] = useState(false)

  // Step 2 (configure) state.
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [loggedIn, setLoggedIn] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    null | { ok: boolean; detail?: string }
  >(null)
  const [saving, setSaving] = useState(false)

  // Step 3 (workspace) + provisioning.
  const [workspaceName, setWorkspaceName] = useState("My Workspace")
  const [provisioning, setProvisioning] = useState(false)

  // Step 4 (launch).
  const [launching, setLaunching] = useState(false)
  const [launchResult, setLaunchResult] = useState<
    null | { ok: boolean; detail?: string }
  >(null)

  const selectedEntry = useMemo(
    () => agents.find((a) => a.name === selectedAgent) || null,
    [agents, selectedAgent],
  )
  const finishedAgentName = useMemo(() => `${selectedAgent}-1`, [selectedAgent])

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

  const loadAgents = useCallback(async (): Promise<OnboardingAgent[]> => {
    setAgentsLoading(true)
    try {
      const list = await window.api.getOnboardingAgents()
      setAgents(list)
      return list
    } catch {
      return []
    } finally {
      setAgentsLoading(false)
    }
  }, [])

  // getOnboardingAgents returns [] until the agent-launcher core finishes
  // installing (common on first launch / slow Windows AV). Poll until the
  // runnable set appears so the picker never strands the user on an empty
  // state. Only runnable agents are returned, so whatever shows up is safe to
  // pick — no more "Agent not found" from choosing an unsupported runtime.
  //
  // This also has to run for the steps AFTER the picker (Configure / Workspace
  // / Launch): a returning user can relaunch straight into a resumed step, and
  // those steps derive `selectedEntry` from `agents`. If we only loaded on the
  // picker step, a resumed Configure step would sit on "Loading configuration…"
  // forever because the agent list was never fetched. Skip once loaded.
  useEffect(() => {
    if (!open || step < 1 || agents.length > 0) return
    let cancelled = false
    let attempt = 0
    const run = async (): Promise<void> => {
      while (!cancelled && attempt < 10) {
        const list = await loadAgents()
        if (cancelled) return
        if (list.length > 0) return
        attempt += 1
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, step, agents.length, loadAgents])

  // If a resumed session points at an agent that's no longer runnable (e.g. it
  // was uninstalled, or its persisted name no longer matches the catalog),
  // don't strand the post-picker steps on a perpetual spinner — once the agent
  // list has actually loaded and the saved selection isn't in it, send the user
  // back to the picker to choose again.
  useEffect(() => {
    if (!open || step < 2) return
    if (agentsLoading || agents.length === 0) return
    if (!selectedEntry) setStep(1)
  }, [open, step, agentsLoading, agents.length, selectedEntry])

  // Initialise the configure step from the selected agent's resolved auth info.
  // No network round-trips for the field list — the picker already carries the
  // authoritative env fields / login command, so an agent that needs auth is
  // never silently shown as "no configuration needed".
  useEffect(() => {
    if (!open || step !== 2 || !selectedEntry) return
    let cancelled = false
    setTestResult(null)
    const seed: Record<string, string> = {}
    for (const f of selectedEntry.envFields) {
      seed[f.name] = f.password ? "" : f.default || ""
    }
    setEnvValues(seed)
    setLoggedIn(false)
    if (selectedEntry.authMode === "login") {
      setCheckingLogin(true)
      window.api
        .healthCheck(selectedEntry.name)
        .then((h) => {
          if (!cancelled) setLoggedIn(!!h?.ready)
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setCheckingLogin(false)
        })
    }
    return () => {
      cancelled = true
    }
  }, [open, step, selectedEntry])

  const close = useCallback(
    (markComplete = false) => {
      if (markComplete) {
        capture("onboarding_completed")
        try {
          localStorage.setItem(ONBOARDING_KEY, "true")
          localStorage.removeItem(STEP_KEY)
        } catch {}
      }
      onClose()
    },
    [onClose],
  )

  const goNext = (): void => setStep((s) => Math.min(s + 1, 4) as Step)
  const goBack = (): void => setStep((s) => Math.max(s - 1, 0) as Step)

  const updateEnvValue = (name: string, value: string): void => {
    setEnvValues((prev) => ({ ...prev, [name]: value }))
    setTestResult(null)
  }

  const installSelectedAgent = async (): Promise<void> => {
    if (!selectedEntry) return
    if (selectedEntry.installed) {
      goNext()
      return
    }
    setInstalling(true)
    try {
      await window.api.installAgentTypeStreaming(selectedEntry.name)
      await loadAgents()
      goNext()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setInstalling(false)
    }
  }

  const testEnvConnection = async (): Promise<void> => {
    if (!selectedEntry || selectedEntry.envFields.length === 0) return
    if (hasMissingRequired(selectedEntry.envFields, envValues)) {
      showToast("Fill in the required fields first", "warning")
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.testLLM(envValues)
      capture("llm_test_run", { success: r.success, model: r.model || null })
      setTestResult(
        r.success
          ? {
              ok: true,
              detail: r.model ? `${r.model} responded` : "Connection looks good",
            }
          : { ok: false, detail: r.error || "Test failed" },
      )
    } catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const openLoginTerminal = async (): Promise<void> => {
    if (!selectedEntry?.loginCommand) return
    try {
      await window.api.openTerminal(selectedEntry.loginCommand)
      showToast("Login terminal opened. Complete login there.", "success")
      setCheckingLogin(true)
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          const h = await window.api.healthCheck(selectedEntry.name)
          if (h?.ready) {
            setLoggedIn(true)
            setCheckingLogin(false)
            return
          }
        } catch {}
      }
      setCheckingLogin(false)
    } catch (e) {
      setCheckingLogin(false)
      showToast((e as Error).message, "error")
    }
  }

  const saveConfigAndContinue = async (): Promise<void> => {
    if (!selectedEntry) return
    if (selectedEntry.authMode === "env" || selectedEntry.envFields.length > 0) {
      if (hasMissingRequired(selectedEntry.envFields, envValues)) {
        showToast("Fill in the required fields first", "warning")
        return
      }
      // Only persist when the user actually entered something — codex et al.
      // have optional env and may rely on CLI login instead.
      const nonEmpty = Object.values(envValues).some((v) => (v || "").trim())
      if (nonEmpty) {
        setSaving(true)
        try {
          await window.api.saveAgentEnv(selectedEntry.name, envValues)
        } catch (e) {
          showToast((e as Error).message, "error")
          setSaving(false)
          return
        }
        setSaving(false)
      }
      goNext()
      return
    }
    // login / none modes: never block. If the agent isn't actually authed yet,
    // the Launch step's real health check will surface it.
    goNext()
  }

  // Atomic provisioning: register the agent (verified) and optionally create +
  // bind a workspace, all in one main-process call. Replaces the old fragile
  // create→add→connect sequence that swallowed errors and produced the
  // "Agent 'x-1' not found" toast.
  const provisionAndContinue = async (includeWorkspace: boolean): Promise<void> => {
    if (!selectedEntry) return
    const name = workspaceName.trim()
    if (includeWorkspace && !name) {
      showToast("Enter a workspace name, or skip this step", "warning")
      return
    }
    setProvisioning(true)
    try {
      const res = await window.api.provisionFirstAgent({
        agentType: selectedEntry.name,
        agentName: finishedAgentName,
        workspaceName: includeWorkspace ? name : null,
      })
      if (res.workspaceName) {
        capture("workspace_created", { source: "onboarding" })
        showToast(`Workspace "${res.workspaceName}" created`, "success")
      }
      if (res.warning) showToast(res.warning, "warning")
      window.api.signalReload()
      await window.api
        .listAgents()
        .then((a) => useAgentsStore.getState().setAgents(a))
        .catch(() => {})
      goNext()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setProvisioning(false)
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

  if (!open) return null

  const visibleAgents = (() => {
    const q = search.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.label || "").toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q),
    )
  })()

  const renderBody = (): React.JSX.Element | null => {
    switch (step) {
      case 0:
        return <WelcomeStep />
      case 1:
        return (
          <AgentSelectionStep
            agents={visibleAgents}
            loading={agentsLoading}
            search={search}
            setSearch={setSearch}
            selected={selectedAgent}
            setSelected={setSelectedAgent}
            onRetry={() => void loadAgents()}
          />
        )
      case 2:
        return (
          <ApiKeyStep
            entry={selectedEntry}
            values={envValues}
            onChangeValue={updateEnvValue}
            onTest={testEnvConnection}
            onLogin={openLoginTerminal}
            testing={testing}
            testResult={testResult}
            loggedIn={loggedIn}
            checkingLogin={checkingLogin}
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
              disabled={!selectedEntry || installing}
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
        // Only required ENV fields gate progress. CLI login is NOT a hard gate:
        // the login happens in an external terminal and the launcher's health
        // check is unreliable for some agents (e.g. Gemini exposes no readiness
        // signal), so blocking on it would strand users who are actually logged
        // in. We show detected status, but always let them continue.
        const needsEnv =
          !!selectedEntry &&
          hasMissingRequired(selectedEntry.envFields, envValues)
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            <Button
              variant="primary"
              onClick={saveConfigAndContinue}
              disabled={saving || needsEnv}
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
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => void provisionAndContinue(false)}
                disabled={provisioning}
              >
                Skip for now
              </Button>
              <Button
                variant="primary"
                onClick={() => void provisionAndContinue(true)}
                disabled={provisioning || !workspaceName.trim()}
              >
                {provisioning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Creating…
                  </>
                ) : (
                  <>
                    Create <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
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
              <Button variant="primary" onClick={launchAgent} disabled={launching}>
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
  const labels = ["Welcome", "Agent", "Configure", "Workspace", "Launch"]
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

function FooterShell({
  children,
}: {
  children?: React.ReactNode
}): React.JSX.Element {
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
        <h1 className="text-[22px] font-bold m-0 tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 m-0 text-[13px] text-(--text-secondary)">{subtitle}</p>
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
          {
            icon: <Cpu className="w-4 h-4" />,
            label: "Install agents (Claude, Codex, Gemini, Kimi…)",
          },
          {
            icon: <KeyRound className="w-4 h-4" />,
            label: "Manage API keys and credentials in one encrypted store",
          },
          {
            icon: <Layers className="w-4 h-4" />,
            label: "Spin up workspaces and chat with running agents",
          },
          {
            icon: <Rocket className="w-4 h-4" />,
            label: "Connect to GitHub, Slack, Discord, Linear and more",
          },
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
  agents,
  loading,
  search,
  setSearch,
  selected,
  setSelected,
  onRetry,
}: {
  agents: OnboardingAgent[]
  loading: boolean
  search: string
  setSearch: (v: string) => void
  selected: string
  setSelected: (v: string) => void
  onRetry: () => void
}): React.JSX.Element {
  return (
    <>
      <StepHeader
        icon={<Cpu className="w-5 h-5" />}
        title="Pick your first agent"
        subtitle="Only agents your installed runtime can run are shown. You can install more later from the Install tab."
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
        {loading && agents.length === 0 && (
          <li className="col-span-1 sm:col-span-2 text-center text-[12px] text-(--text-tertiary) py-6 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading agents…
          </li>
        )}
        {!loading && agents.length === 0 && (
          <li className="col-span-1 sm:col-span-2 text-center text-[12px] text-(--text-tertiary) py-6 flex flex-col items-center gap-3">
            <span>
              {search.trim()
                ? "No agents match your search."
                : "The agent runtime is still installing — this can take a minute on first launch."}
            </span>
            {!search.trim() && (
              <Button size="sm" variant="ghost" onClick={onRetry}>
                Retry
              </Button>
            )}
          </li>
        )}
        {agents.map((c) => {
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
  entry,
  values,
  onChangeValue,
  onTest,
  onLogin,
  testing,
  testResult,
  loggedIn,
  checkingLogin,
}: {
  entry: OnboardingAgent | null
  values: Record<string, string>
  onChangeValue: (name: string, value: string) => void
  onTest: () => void
  onLogin: () => void
  testing: boolean
  testResult: null | { ok: boolean; detail?: string }
  loggedIn: boolean
  checkingLogin: boolean
}): React.JSX.Element {
  const label = entry?.label || entry?.name || "this agent"
  const mode = entry?.authMode ?? "none"
  const hasLogin = !!entry?.loginCommand
  const hasEnvFields = !!entry && entry.envFields.length > 0
  const subtitle =
    mode === "env"
      ? `Configure ${label}. Saved to ~/.openagents/env/ and injected into the agent automatically.`
      : mode === "login"
        ? `${label} signs in through its own CLI${hasEnvFields ? " — or enter an API key below instead." : "."}`
        : `${label} doesn't need any environment configuration.`

  // Claude Code refuses to run under cmd.exe on Windows; the launcher opens
  // PowerShell, but if the CLI also needs bash the user must have Git for
  // Windows. Surface that up front instead of a cryptic terminal error.
  const showWindowsShellNote =
    isWindows && hasLogin && /^claude\b/.test(entry?.loginCommand || "")

  // Reusable: the env-field inputs (used as the primary view in "env" mode and
  // as the optional "prefer an API key" section inside "login" mode).
  const envInputs = entry ? (
    <div className="flex flex-col gap-4">
      {entry.envFields.map((f) => {
        const FieldInput = f.password ? PasswordInput : Input
        const value = values[f.name] ?? ""
        return (
          <div key={f.name}>
            <label className="block text-[12px] font-medium mb-1.5">
              {f.description || f.name}
              {f.required && (
                <span className="text-(--danger-text) ml-0.5">*</span>
              )}
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
  ) : null

  const testRow = (
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
      {entry?.docsUrl && (
        <a
          href={entry.docsUrl}
          onClick={(e) => {
            e.preventDefault()
            if (entry?.docsUrl) window.api.openExternal(entry.docsUrl)
          }}
          className="text-[12px] text-(--accent) hover:underline"
        >
          Where do I get a key?
        </a>
      )}
    </div>
  )

  const loginBlock = entry ? (
    <div className="p-4 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
      {loggedIn && (
        <div className="flex items-center gap-2 text-[13px] mb-3 text-(--success-text)">
          <span>✓</span>
          <strong>Detected an active login</strong>
        </div>
      )}
      <p className="text-[12px] text-(--text-secondary) m-0 mb-3">
        {label} signs in through its own CLI. Open a terminal and run{" "}
        <code className="inline-code">{entry.loginCommand}</code> to authenticate.
        When the CLI says you're signed in, come back and click{" "}
        <strong>Save & continue</strong>.
      </p>
      {showWindowsShellNote && (
        <div className="flex items-start gap-2 text-[11px] text-(--text-secondary) mb-3 p-2.5 rounded-sm bg-(--bg-input)">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-(--warning-text)" />
          <span>
            Claude Code on Windows needs PowerShell (opened for you) or Git for
            Windows. If login fails, install{" "}
            <a
              href="https://git-scm.com/downloads/win"
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal("https://git-scm.com/downloads/win")
              }}
              className="text-(--accent) hover:underline"
            >
              Git for Windows
            </a>{" "}
            or{" "}
            <a
              href="https://aka.ms/powershell"
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal("https://aka.ms/powershell")
              }}
              className="text-(--accent) hover:underline"
            >
              PowerShell 7
            </a>{" "}
            and retry.
          </span>
        </div>
      )}
      <Button
        size="sm"
        variant="primary"
        onClick={onLogin}
        disabled={checkingLogin}
      >
        {checkingLogin ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for login…
          </>
        ) : loggedIn ? (
          "Re-open login terminal"
        ) : (
          "Open login terminal"
        )}
      </Button>
      <p className="mt-3 text-[11px] text-(--text-tertiary) m-0">
        We can't reliably detect every CLI login, so this step never blocks you —
        if the agent isn't actually signed in, the Launch step will surface it.
      </p>
      {hasEnvFields && (
        <div className="mt-4 pt-4 border-t border-(--border)">
          <p className="text-[12px] font-medium m-0 mb-3">
            Prefer an API key? Enter it instead:
          </p>
          {envInputs}
          {testRow}
        </div>
      )}
    </div>
  ) : null

  return (
    <>
      <StepHeader
        icon={<KeyRound className="w-5 h-5" />}
        title="Configure agent"
        subtitle={subtitle}
      />

      {!entry ? (
        <div className="flex items-center gap-2 text-[12px] text-(--text-tertiary) py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading configuration…
        </div>
      ) : mode === "env" ? (
        <>
          {envInputs}
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
            {hasLogin && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onLogin}
                disabled={checkingLogin}
              >
                {checkingLogin
                  ? "Waiting for login…"
                  : loggedIn
                    ? "Re-login via CLI"
                    : "Or log in via CLI"}
              </Button>
            )}
            {entry.docsUrl && (
              <a
                href={entry.docsUrl}
                onClick={(e) => {
                  e.preventDefault()
                  if (entry.docsUrl) window.api.openExternal(entry.docsUrl)
                }}
                className="text-[12px] text-(--accent) hover:underline"
              >
                Where do I get a key?
              </a>
            )}
          </div>
        </>
      ) : mode === "login" ? (
        loginBlock
      ) : (
        <div className="p-4 rounded-(--radius-sm) bg-(--success-bg) text-(--success-text) text-[12px]">
          No configuration needed. Click <strong>Save & continue</strong> to move
          on.
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
        subtitle="A workspace is where agents collaborate. This is optional — you can skip it and connect one later."
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
        We'll create a new workspace at{" "}
        <code className="inline-code">workspace.openagents.org</code> and bind
        your first agent to it. Prefer to do this later? Use{" "}
        <strong>Skip for now</strong>.
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
