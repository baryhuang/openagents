import React, { useEffect, useState } from "react"
import { Modal, ModalTitle } from "../ui/Modal"
import AgentIcon from "../AgentIcon"
import { cn } from "../../lib/utils"
import { useUiStore } from "../../store/ui"
import type { CatalogEntry, EnvField } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { SetupApiConfig } from "./SetupApiConfig"
import { SetupConnectionTest } from "./SetupConnectionTest"
import { SetupCreateInstance } from "./SetupCreateInstance"

type Step = "configure" | "test" | "create"

interface SetupWizardProps {
  entry: CatalogEntry | null
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Post-install setup wizard (stage.md §2.4). Composes the three step
 * components and owns the IPC plumbing — fetching env_config, saving env,
 * running testLLM, and finally addAgent. Skipping at any step is allowed so
 * the user is never trapped.
 */
export default function SetupWizard({
  entry,
  open,
  onClose,
  showToast,
}: SetupWizardProps): React.JSX.Element | null {
  const [step, setStep] = useState<Step>("configure")
  const [envFields, setEnvFields] = useState<EnvField[]>([])
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [agentName, setAgentName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)

  useEffect(() => {
    if (!open || !entry) return
    setStep("configure")
    setTestResult(null)
    setAgentName(`my-${entry.name}`)
    ;(async () => {
      try {
        const [fields, saved] = await Promise.all([
          window.api.getEnvFields(entry.name).catch(() => [] as EnvField[]),
          window.api.getAgentEnv(entry.name).catch(() => ({}) as Record<string, string>),
        ])
        setEnvFields(fields || [])
        setEnvValues({ ...(saved || {}) })
        if (!fields || fields.length === 0) setStep("create")
      } catch {
        setEnvFields([])
      }
    })()
  }, [open, entry])

  if (!entry) return null

  async function saveAndTest(): Promise<void> {
    if (!entry) return
    setTesting(true)
    setTestResult(null)
    try {
      await window.api.saveAgentEnv(entry.name, envValues)
      try {
        const r = await window.api.testLLM(envValues)
        if (r.success) {
          setTestResult({ ok: true, message: `OK — ${r.model || "model"} responded` })
          setStep("test")
        } else {
          setTestResult({ ok: false, message: r.error || "Test failed" })
        }
      } catch (e: unknown) {
        setTestResult({ ok: false, message: (e as Error).message })
      }
    } finally {
      setTesting(false)
    }
  }

  async function createAgent(): Promise<void> {
    if (!entry) return
    const name = agentName.trim() || `my-${entry.name}`
    setSubmitting(true)
    try {
      await window.api.addAgent({ name, type: entry.name })
      showToast(`Created agent "${name}"`, "success")
      onClose()
      setCurrentTab("agents")
    } catch (e: unknown) {
      showToast(`Failed to create agent: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  const stepIndex: Record<Step, number> = { configure: 0, test: 1, create: 2 }
  const idx = stepIndex[step]
  const steps: Array<{ key: Step; label: string }> = [
    { key: "configure", label: "API config" },
    { key: "test", label: "Test connection" },
    { key: "create", label: "Create agent" },
  ]

  return (
    <Modal open={open} onClose={onClose} className="!min-w-[480px] !max-w-[560px]">
      <div className="flex items-center gap-3 mb-3">
        <AgentIcon type={entry.name} size={28} />
        <ModalTitle style={{ margin: 0 }}>
          Set up {entry.label || entry.name}
        </ModalTitle>
      </div>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Quick setup — configure, verify, then create your first agent.
      </p>

      <div className="wizard-steps">
        {steps.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <div className="wizard-step-sep" />}
            <div className={cn("wizard-step", idx === i && "active", idx > i && "done")}>
              <span className="dot">{idx > i ? "✓" : i + 1}</span>
              <span>{s.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {step === "configure" && (
        <SetupApiConfig
          fields={envFields}
          values={envValues}
          onChange={setEnvValues}
          testing={testing}
          errorMessage={testResult && !testResult.ok ? testResult.message : null}
          onSubmit={envFields.length === 0 ? () => setStep("create") : saveAndTest}
          onSkip={onClose}
        />
      )}

      {step === "test" && (
        <SetupConnectionTest
          ok={!!testResult?.ok}
          message={testResult?.message || "Connection successful."}
          onNext={() => setStep("create")}
          onBack={() => setStep("configure")}
        />
      )}

      {step === "create" && (
        <SetupCreateInstance
          agentName={agentName}
          setAgentName={setAgentName}
          defaultName={`my-${entry.name}`}
          submitting={submitting}
          onSubmit={createAgent}
          onCancel={onClose}
        />
      )}
    </Modal>
  )
}
