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
import { Select } from "../ui/Select"
import AgentIcon from "../AgentIcon"
import { useAgentsStore } from "../../store/agents"
import { useCredentialsStore } from "../../store/credentials"
import type { CatalogEntry } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"

const ONBOARDING_KEY = "onboarding_completed"
const STEP_KEY = "onboarding_step"
const SELECTED_AGENT_KEY = "last_selected_agent"

type Step = 0 | 1 | 2 | 3 | 4

const PROVIDERS: Array<{
  id: string
  label: string
  envKey: string
  docs: string
  placeholder: string
}> = [
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    docs: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-...",
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    docs: "https://platform.openai.com/api-keys",
    placeholder: "sk-...",
  },
  {
    id: "google",
    label: "Google",
    envKey: "GOOGLE_API_KEY",
    docs: "https://aistudio.google.com/app/apikey",
    placeholder: "AIza...",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    docs: "https://openrouter.ai/keys",
    placeholder: "sk-or-...",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    docs: "https://platform.deepseek.com/api_keys",
    placeholder: "sk-...",
  },
]

function detectProvider(key: string): string | null {
  const v = key.trim()
  if (!v) return null
  if (v.startsWith("sk-ant-")) return "anthropic"
  if (v.startsWith("sk-or-")) return "openrouter"
  if (v.startsWith("AIza")) return "google"
  if (v.startsWith("sk-")) return "openai"
  return null
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
  const [provider, setProvider] = useState(PROVIDERS[0].id)
  const [apiKey, setApiKey] = useState("")
  const [keyTesting, setKeyTesting] = useState(false)
  const [keyTestResult, setKeyTestResult] = useState<
    null | { ok: boolean; detail?: string }
  >(null)
  const [workspaceName, setWorkspaceName] = useState("My Workspace")
  const [creating, setCreating] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchResult, setLaunchResult] = useState<
    null | { ok: boolean; detail?: string }
  >(null)

  // Persist step
  useEffect(() => {
    try {
      localStorage.setItem(STEP_KEY, String(step))
    } catch {}
  }, [step])

  // Persist selected agent
  useEffect(() => {
    if (selectedAgent) {
      try {
        localStorage.setItem(SELECTED_AGENT_KEY, selectedAgent)
      } catch {}
    }
  }, [selectedAgent])

  // Auto-detect provider from key
  useEffect(() => {
    const detected = detectProvider(apiKey)
    if (detected && detected !== provider) setProvider(detected)
  }, [apiKey, provider])

  // Load catalog when opening Step 2
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

  // ── Step 3: test key ──
  const testKey = async (): Promise<void> => {
    if (!apiKey.trim()) return
    setKeyTesting(true)
    setKeyTestResult(null)
    try {
      const r = await window.api.testCredential({
        provider,
        secret: apiKey.trim(),
      })
      setKeyTestResult({ ok: r.ok, detail: r.detail })
    } catch (e) {
      setKeyTestResult({ ok: false, detail: (e as Error).message })
    } finally {
      setKeyTesting(false)
    }
  }

  const saveCredentialAndContinue = async (): Promise<void> => {
    if (!apiKey.trim()) {
      showToast("Enter an API key first", "warning")
      return
    }
    const def = PROVIDERS.find((p) => p.id === provider)
    if (!def) return
    try {
      const res = await window.api.upsertCredential({
        provider: def.id,
        kind: "api_key",
        label: `${def.label} key`,
        secret: apiKey.trim(),
      })
      if (!res.ok) {
        showToast(res.error || "Failed to save credential", "error")
        return
      }
      if (selectedAgent && res.record) {
        await window.api.applyCredentialToAgents({
          credentialId: res.record.id,
          envKey: def.envKey,
          agentTypes: [selectedAgent],
        })
      }
      await useCredentialsStore.getState().refresh()
      goNext()
    } catch (e) {
      showToast((e as Error).message, "error")
    }
  }

  // ── Step 4: create workspace + add agent ──
  const createWorkspaceAndContinue = async (): Promise<void> => {
    if (!workspaceName.trim()) {
      showToast("Enter a workspace name", "warning")
      return
    }
    setCreating(true)
    try {
      await window.api.createWorkspace(workspaceName.trim()).catch(() => null)
      // Add the first agent instance bound to the chosen type.
      try {
        await window.api.addAgent({
          name: finishedAgentName,
          type: selectedAgent,
        })
      } catch {
        // It's OK if the agent already exists.
      }
      await window.api
        .listAgents()
        .then((a) => useAgentsStore.getState().setAgents(a))
      goNext()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setCreating(false)
    }
  }

  // ── Step 5: launch agent ──
  const launchAgent = async (): Promise<void> => {
    setLaunching(true)
    setLaunchResult(null)
    try {
      await window.api.startAgent(finishedAgentName)
      // Poll up to ~15s for ready state
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

  return ReactDOM.createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg-primary)",
        zIndex: 1500,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ProgressBar step={step} />

      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <div className="w-full max-w-[720px]">
          {step === 0 && <WelcomeStep onStart={goNext} onSkip={() => close(true)} />}
          {step === 1 && (
            <AgentSelectionStep
              catalog={visibleCatalog}
              loading={catalogLoading}
              search={search}
              setSearch={setSearch}
              selected={selectedAgent}
              setSelected={setSelectedAgent}
              installing={installing}
              onBack={goBack}
              onNext={installSelectedAgent}
              onSkip={() => close(true)}
            />
          )}
          {step === 2 && (
            <ApiKeyStep
              provider={provider}
              setProvider={setProvider}
              apiKey={apiKey}
              setApiKey={setApiKey}
              testKey={testKey}
              keyTesting={keyTesting}
              keyTestResult={keyTestResult}
              onBack={goBack}
              onNext={saveCredentialAndContinue}
              onSkip={goNext}
            />
          )}
          {step === 3 && (
            <WorkspaceStep
              name={workspaceName}
              setName={setWorkspaceName}
              creating={creating}
              onBack={goBack}
              onNext={createWorkspaceAndContinue}
              onSkip={goNext}
            />
          )}
          {step === 4 && (
            <LaunchStep
              agentName={finishedAgentName}
              launching={launching}
              result={launchResult}
              onLaunch={launchAgent}
              onBack={goBack}
              onFinish={() => close(true)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Components ───────────────────────────────────────────────

function ProgressBar({ step }: { step: Step }): React.JSX.Element {
  const labels = ["Welcome", "Agent", "API key", "Workspace", "Launch"]
  return (
    <div className="px-8 pt-6 pb-4 border-b border-(--border) bg-(--bg-card)">
      <div className="flex items-center gap-3 max-w-[720px] mx-auto">
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

function StepShell({
  icon,
  title,
  subtitle,
  children,
  actions,
}: {
  icon: React.JSX.Element
  title: string
  subtitle: string
  children: React.ReactNode
  actions: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-(--radius-sm) bg-(--accent-bg) text-(--accent) flex items-center justify-center">
          {icon}
        </div>
        <div>
          <h1 className="text-[22px] font-bold m-0 tracking-[-0.02em]">{title}</h1>
          <p className="m-0 text-[13px] text-(--text-secondary)">{subtitle}</p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
      <div className="flex items-center justify-between mt-8 pt-4 border-t border-(--border)">
        {actions}
      </div>
    </div>
  )
}

function WelcomeStep({
  onStart,
  onSkip,
}: {
  onStart: () => void
  onSkip: () => void
}): React.JSX.Element {
  return (
    <StepShell
      icon={<Sparkles className="w-5 h-5" />}
      title="Welcome to OpenAgents Launcher"
      subtitle="Run, configure, and orchestrate AI coding agents from one place."
      actions={
        <>
          <Button variant="ghost" onClick={onSkip}>
            Skip setup
          </Button>
          <Button variant="primary" onClick={onStart}>
            Get started <ChevronRight className="w-4 h-4" />
          </Button>
        </>
      }
    >
      <ul className="grid grid-cols-2 gap-3 list-none m-0 p-0">
        {[
          { icon: <Cpu className="w-4 h-4" />, label: "Install agents (Claude, Codex, OpenCode, Hermes…)" },
          { icon: <KeyRound className="w-4 h-4" />, label: "Manage API keys and credentials in one encrypted store" },
          { icon: <Layers className="w-4 h-4" />, label: "Spin up workspaces and chat with running agents" },
          { icon: <Rocket className="w-4 h-4" />, label: "Connect to GitHub, Slack, Discord, Linear and more" },
        ].map((b) => (
          <li
            key={b.label}
            className="flex items-start gap-3 p-3 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)"
          >
            <div className="text-(--accent) mt-0.5">{b.icon}</div>
            <span className="text-[12px] text-(--text-primary)">{b.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] text-(--text-tertiary)">
        We'll have you running your first agent in under two minutes.
      </p>
    </StepShell>
  )
}

function AgentSelectionStep({
  catalog,
  loading,
  search,
  setSearch,
  selected,
  setSelected,
  installing,
  onBack,
  onNext,
  onSkip,
}: {
  catalog: CatalogEntry[]
  loading: boolean
  search: string
  setSearch: (v: string) => void
  selected: string
  setSelected: (v: string) => void
  installing: boolean
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}): React.JSX.Element {
  return (
    <StepShell
      icon={<Cpu className="w-5 h-5" />}
      title="Pick your first agent"
      subtitle="You can install more later from the Install tab."
      actions={
        <>
          <Button variant="ghost" onClick={onBack}>
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onSkip}>
              Skip setup
            </Button>
            <Button
              variant="primary"
              onClick={onNext}
              disabled={!selected || installing}
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
          </div>
        </>
      }
    >
      <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
        <Search className="w-3.5 h-3.5 text-(--text-tertiary)" />
        <input
          className="flex-1 bg-transparent border-0 outline-none text-[13px]"
          placeholder="Search agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ul className="grid grid-cols-2 gap-2.5 list-none m-0 p-0 max-h-[360px] overflow-y-auto">
        {loading && (
          <li className="col-span-2 text-center text-[12px] text-(--text-tertiary) py-6">
            Loading catalog…
          </li>
        )}
        {!loading && catalog.length === 0 && (
          <li className="col-span-2 text-center text-[12px] text-(--text-tertiary) py-6">
            No agents match.
          </li>
        )}
        {!loading &&
          catalog.map((c) => {
            const active = c.name === selected
            return (
              <li key={c.name}>
                <button
                  type="button"
                  onClick={() => setSelected(c.name)}
                  className={cn(
                    "w-full text-left p-3 rounded-(--radius-sm) border bg-(--bg-card) cursor-pointer transition-colors",
                    active
                      ? "border-(--accent) ring-2 ring-(--accent-border)"
                      : "border-(--border) hover:border-(--border-hover)",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <AgentIcon type={c.name} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
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
                      <div className="text-[11px] text-(--text-secondary) line-clamp-2 mt-0.5">
                        {c.description || "—"}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
      </ul>
    </StepShell>
  )
}

function ApiKeyStep({
  provider,
  setProvider,
  apiKey,
  setApiKey,
  testKey,
  keyTesting,
  keyTestResult,
  onBack,
  onNext,
  onSkip,
}: {
  provider: string
  setProvider: (v: string) => void
  apiKey: string
  setApiKey: (v: string) => void
  testKey: () => void
  keyTesting: boolean
  keyTestResult: null | { ok: boolean; detail?: string }
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}): React.JSX.Element {
  const def = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0]
  return (
    <StepShell
      icon={<KeyRound className="w-5 h-5" />}
      title="Configure API key"
      subtitle="Stored encrypted on your machine. We'll wire it into the agent's .env automatically."
      actions={
        <>
          <Button variant="ghost" onClick={onBack}>
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
            <Button variant="primary" onClick={onNext}>
              Save & continue <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5">
            Provider
          </label>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5">
            Env var
          </label>
          <Input value={def.envKey} readOnly />
        </div>
      </div>

      <label className="block text-[12px] font-medium mb-1.5">
        API key
      </label>
      <PasswordInput
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={def.placeholder}
      />
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" onClick={testKey} disabled={!apiKey.trim() || keyTesting}>
          {keyTesting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…
            </>
          ) : (
            "Test connection"
          )}
        </Button>
        <a
          href={def.docs}
          onClick={(e) => {
            e.preventDefault()
            window.api.openExternal(def.docs)
          }}
          className="text-[12px] text-(--accent) hover:underline"
        >
          Where do I get a key?
        </a>
      </div>
      {keyTestResult && (
        <div
          className={cn(
            "mt-3 px-3 py-2 rounded-sm text-[12px]",
            keyTestResult.ok
              ? "bg-(--success-bg) text-(--success-text)"
              : "bg-(--danger-bg) text-(--danger-text)",
          )}
        >
          {keyTestResult.ok ? "✓ Connected" : "✗ Failed"}
          {keyTestResult.detail && (
            <span className="ml-1.5 opacity-80">— {keyTestResult.detail}</span>
          )}
        </div>
      )}
    </StepShell>
  )
}

function WorkspaceStep({
  name,
  setName,
  creating,
  onBack,
  onNext,
  onSkip,
}: {
  name: string
  setName: (v: string) => void
  creating: boolean
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}): React.JSX.Element {
  return (
    <StepShell
      icon={<Layers className="w-5 h-5" />}
      title="Create a workspace"
      subtitle="A workspace is where agents collaborate. You can connect more later."
      actions={
        <>
          <Button variant="ghost" onClick={onBack}>
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onSkip}>
              Skip
            </Button>
            <Button variant="primary" onClick={onNext} disabled={creating}>
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
          </div>
        </>
      }
    >
      <label className="block text-[12px] font-medium mb-1.5">
        Workspace name
      </label>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="My Workspace"
      />
      <p className="mt-2 text-[11px] text-(--text-tertiary)">
        We'll create a new workspace at <code className="inline-code">workspace.openagents.org</code> and
        register your first agent against it.
      </p>
    </StepShell>
  )
}

function LaunchStep({
  agentName,
  launching,
  result,
  onLaunch,
  onBack,
  onFinish,
}: {
  agentName: string
  launching: boolean
  result: null | { ok: boolean; detail?: string }
  onLaunch: () => void
  onBack: () => void
  onFinish: () => void
}): React.JSX.Element {
  return (
    <StepShell
      icon={<Rocket className="w-5 h-5" />}
      title="Launch your agent"
      subtitle={`Start ${agentName} and verify it reaches a healthy state.`}
      actions={
        <>
          <Button variant="ghost" onClick={onBack}>
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          {result?.ok ? (
            <Button variant="primary" onClick={onFinish}>
              Go to Dashboard <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onFinish}>
                Finish setup
              </Button>
              <Button variant="primary" onClick={onLaunch} disabled={launching}>
                {launching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Launching…
                  </>
                ) : (
                  "Launch agent"
                )}
              </Button>
            </div>
          )}
        </>
      }
    >
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
            Click <strong>Launch agent</strong> to start it now, or finish setup
            and start it later from the Dashboard.
          </p>
        )}
      </div>
    </StepShell>
  )
}

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== "true"
  } catch {
    return false
  }
}
