import React, { useState } from "react"
import { Input } from "../ui/Input"
import { PasswordInput } from "../ui/PasswordInput"
import { Button } from "../ui/Button"
import type { EnvField } from "../../types"
import type { ToastType } from "../../hooks/useToast"

const SECTION = "px-4.5 py-4 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm"
const SECTION_H4 = "text-xs font-semibold uppercase tracking-wider text-(--text-secondary) m-0 mb-2.5"

interface AgentEnvConfigProps {
  agentName: string
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Env / API key configuration card. Saves to `~/.openagents/env/` via
 * window.api.saveAgentEnv, never echoes secrets back into showToast / log
 * lines. Includes an inline "Test connection" button that piggybacks on the
 * agent-launcher core's testLLM helper.
 */
export function AgentEnvConfig({
  agentName,
  fields,
  values,
  onChange,
  showToast,
}: AgentEnvConfigProps): React.JSX.Element | null {
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (fields.length === 0) return null

  async function saveEnv(): Promise<void> {
    // The inputs display `f.default` as a fallback, but an untouched field is
    // absent from `values` — fold defaults in so a pre-filled value is actually
    // persisted, then enforce required fields against the resolved payload.
    const payload: Record<string, string> = {}
    for (const f of fields) {
      payload[f.name] = (values[f.name] ?? f.default ?? "").trim()
    }
    const missing = fields.find((f) => f.required && !payload[f.name])
    if (missing) {
      showToast(`${missing.description || missing.name} is required`, "warning")
      return
    }
    setSaving(true)
    try {
      await window.api.saveAgentEnv(agentName, payload)
      showToast("Configuration saved", "success")
    } catch (e: unknown) {
      showToast(`Error: ${(e as Error).message}`, "error")
    } finally {
      setSaving(false)
    }
  }

  async function testConnection(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.testLLM(values)
      setTestResult(
        r.success
          ? { ok: true, message: `OK — ${r.model || "model"} responded` }
          : { ok: false, message: r.error || "Test failed" },
      )
    } catch (e: unknown) {
      setTestResult({ ok: false, message: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={SECTION}>
      <h4 className={SECTION_H4}>Configuration</h4>
      {fields.map((f) => {
        const FieldInput = f.password ? PasswordInput : Input
        return (
          <div className="form-group" key={f.name}>
            <label>
              {f.description || f.name}
              {f.required && <span className="required"> *</span>}
            </label>
            <FieldInput
              value={values[f.name] ?? f.default ?? ""}
              onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
              placeholder={f.placeholder || `Enter ${f.name}…`}
            />
          </div>
        )
      })}
      {testResult && (
        <p
          className={`text-xs mt-1 mb-2.5 ${testResult.ok ? "test-success" : "test-error"}`}
        >
          {testResult.message}
        </p>
      )}
      <div className="form-actions mt-1">
        <Button size="sm" variant="primary" onClick={saveEnv} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" onClick={testConnection} disabled={testing}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
      </div>
    </div>
  )
}
