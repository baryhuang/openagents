import React, { useState } from "react"
import { Eye, EyeOff, Copy, Trash2, Pencil, Check, Link2 } from "lucide-react"
import { Button } from "../ui/Button"
import { Badge } from "../ui/Badge"
import { PlatformLogo } from "../connections/PlatformLogo"
import { getPlatform } from "../connections/platforms"
import { CredentialUsage } from "./CredentialUsage"
import type { CredentialSummary } from "../../types"

export function CredentialCard({
  cred,
  onEdit,
  onRemove,
  onTest,
  onReveal,
  onApply,
  revealed,
  testing,
}: {
  cred: CredentialSummary
  onEdit: () => void
  onRemove: () => void
  onTest: () => void
  onReveal: () => Promise<void>
  onApply: () => void
  revealed: string | null
  testing: boolean
}): React.JSX.Element {
  const platform = getPlatform(cred.provider)
  const [copied, setCopied] = useState(false)

  const copySecret = async (): Promise<void> => {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const lastTest = cred.lastTestedAt
    ? new Date(cred.lastTestedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null

  return (
    <div className="flex flex-col gap-3 px-[18px] py-4 mb-2.5 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm transition-all duration-200 hover:shadow-md hover:border-(--border-hover)">
      <div className="flex items-start gap-3">
        {platform ? (
          <PlatformLogo platform={platform} size={32} />
        ) : (
          <div className="flex items-center justify-center rounded-md shrink-0 text-white font-bold bg-(--text-tertiary) w-8 h-8 text-sm">
            ?
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[13px] tracking-tight truncate">
              {cred.label}
            </span>
            <Badge variant="default" className="!text-[9px] !py-[1px] !px-[6px]">
              {cred.kind.replace("_", " ")}
            </Badge>
            {cred.shared && (
              <Badge variant="info" className="!text-[9px] !py-[1px] !px-[6px]">
                shared
              </Badge>
            )}
            {cred.scopes?.map((s) => (
              <Badge
                key={s}
                variant="default"
                className="!text-[9px] !py-[1px] !px-[6px] !bg-(--accent-bg) !text-(--text-link)"
              >
                {s}
              </Badge>
            ))}
          </div>
          <div className="text-[11px] text-(--text-tertiary) mt-0.5">
            {platform?.label || cred.provider}
            {lastTest && (
              <>
                {" · "}
                <span
                  className={
                    cred.lastTestOk ? "text-(--success-text)" : "text-(--danger-text)"
                  }
                >
                  Tested {lastTest} {cred.lastTestOk ? "✓" : "✗"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 px-3 py-1.5 bg-(--bg-input) rounded-sm font-mono text-[12px] text-(--text-secondary) truncate">
          {revealed ?? cred.secretMasked}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onReveal}
          title={revealed ? "Hide" : "Reveal"}
        >
          {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </Button>
        {revealed && (
          <Button size="icon" variant="ghost" onClick={copySecret} title="Copy">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>

      <CredentialUsage cred={cred} />

      <div className="flex gap-2 mt-1 flex-wrap">
        <Button size="sm" onClick={onTest} disabled={testing}>
          {testing ? "Testing..." : "Test"}
        </Button>
        <Button size="sm" onClick={onApply}>
          <Link2 className="w-3 h-3" />
          Apply to agent
        </Button>
        <Button size="sm" onClick={onEdit}>
          <Pencil className="w-3 h-3" />
          Edit
        </Button>
        <Button size="sm" variant="destructive" onClick={onRemove}>
          <Trash2 className="w-3 h-3" />
          Remove
        </Button>
      </div>
    </div>
  )
}
