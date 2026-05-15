import React, { useEffect, useState } from "react"
import { Modal, ModalTitle } from "./ui/Modal"
import { Button } from "./ui/Button"
import { Input } from "./ui/Input"
import AgentIcon from "./AgentIcon"
import { cn } from "../lib/utils"
import { useUiStore } from "../store/ui"
import type { CatalogEntry, EnvField } from "../types"
import type { ToastType } from "../hooks/useToast"

type Step = "configure" | "test" | "create"

interface SetupWizardProps {
  entry: CatalogEntry | null
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}

export default function SetupWizard({ entry, open, onClose, showToast }: SetupWizardProps): React.JSX.Element | null {
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
        // If no config required, jump to create step
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
    setSubmitting(true)
    try {
      await window.api.addAgent({ name: agentName.trim() || `my-${entry.name}`, type: entry.name })
      showToast(`Created agent "${agentName}"`, "success")
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

  return (
    <Modal open={open} onClose={onClose} className="!min-w-[480px] !max-w-[560px]">
      <div className="flex items-center gap-3 mb-3">
        <AgentIcon type={entry.name} size={28} />
        <ModalTitle style={{ margin: 0 }}>Set up {entry.label || entry.name}</ModalTitle>
      </div>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        A short wizard to get you from install to first agent run.
      </p>

      <div className="wizard-steps">
        {[
          { key: "configure" as Step, label: "API Key" },
          { key: "test" as Step, label: "Test" },
          { key: "create" as Step, label: "Create" },
        ].map((s, i) => (
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
        <>
          {envFields.length === 0 ? (
            <p className="hint">No configuration required. You can create your first agent.</p>
          ) : (
            <>
              {envFields.map((f) => (
                <div className="form-group" key={f.name}>
                  <label>
                    {f.description || f.name}
                    {f.required && <span className="required"> *</span>}
                  </label>
                  <Input
                    type={f.password ? "password" : "text"}
                    value={envValues[f.name] ?? f.default ?? ""}
                    onChange={(e) => setEnvValues({ ...envValues, [f.name]: e.target.value })}
                    placeholder={f.placeholder || `Enter ${f.name}…`}
                  />
                </div>
              ))}
              {testResult && (
                <p className={testResult.ok ? "test-success" : "test-error"} style={{ fontSize: 12, marginBottom: 8 }}>
                  {testResult.message}
                </p>
              )}
            </>
          )}
          <div className="form-actions">
            {envFields.length === 0 ? (
              <Button variant="primary" onClick={() => setStep("create")}>Continue</Button>
            ) : (
              <Button variant="primary" onClick={saveAndTest} disabled={testing}>
                {testing ? "Testing…" : "Save & test connection"}
              </Button>
            )}
            <Button onClick={onClose}>Skip</Button>
          </div>
        </>
      )}

      {step === "test" && (
        <>
          <p className="test-success" style={{ fontSize: 13 }}>
            {testResult?.message || "Connection successful."}
          </p>
          <p className="hint">Now name your first agent instance.</p>
          <div className="form-actions">
            <Button variant="primary" onClick={() => setStep("create")}>Next: Create agent</Button>
            <Button onClick={() => setStep("configure")}>Back</Button>
          </div>
        </>
      )}

      {step === "create" && (
        <>
          <div className="form-group">
            <label>Agent name</label>
            <Input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder={`my-${entry.name}`}
            />
          </div>
          <div className="form-actions">
            <Button variant="primary" onClick={createAgent} disabled={submitting || !agentName.trim()}>
              {submitting ? "Creating…" : "Create agent"}
            </Button>
            <Button onClick={onClose}>Finish later</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
