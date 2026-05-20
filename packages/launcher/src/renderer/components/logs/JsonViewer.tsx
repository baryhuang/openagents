import React, { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "../../lib/utils"

interface Props {
  value: unknown
  collapsed?: boolean
  depth?: number
}

function tokenColor(t: string): string {
  if (t === "string") return "var(--success-text)"
  if (t === "number") return "var(--accent)"
  if (t === "boolean" || t === "null") return "var(--warning-text)"
  return "var(--text-primary)"
}

export function JsonViewer({
  value,
  collapsed = true,
  depth = 0,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(!collapsed || depth === 0)
  if (value === null) {
    return <span style={{ color: tokenColor("null") }}>null</span>
  }
  if (typeof value === "string") {
    return <span style={{ color: tokenColor("string") }}>"{value}"</span>
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span style={{ color: tokenColor(typeof value) }}>{String(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>
    return (
      <span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center align-middle cursor-pointer border-0 bg-transparent p-0 text-(--text-secondary)"
          aria-label="Toggle"
        >
          {open ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        <span> [{!open && <span className="text-(--text-tertiary)"> {value.length} items </span>}{open && "\n"}</span>
        {open && (
          <span style={{ paddingLeft: 12, display: "block" }}>
            {value.map((v, i) => (
              <span key={i} className="block">
                <JsonViewer value={v} depth={depth + 1} />
                {i < value.length - 1 ? "," : ""}
              </span>
            ))}
          </span>
        )}
        <span>]</span>
      </span>
    )
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return <span>{"{}"}</span>
    return (
      <span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "inline-flex items-center align-middle cursor-pointer border-0 bg-transparent p-0 text-(--text-secondary)",
          )}
          aria-label="Toggle"
        >
          {open ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        <span>
          {" {"}
          {!open && <span className="text-(--text-tertiary)"> {keys.length} keys </span>}
          {open && "\n"}
        </span>
        {open && (
          <span style={{ paddingLeft: 12, display: "block" }}>
            {keys.map((k, i) => (
              <span key={k} className="block">
                <span style={{ color: "var(--accent)" }}>"{k}"</span>:{" "}
                <JsonViewer value={obj[k]} depth={depth + 1} />
                {i < keys.length - 1 ? "," : ""}
              </span>
            ))}
          </span>
        )}
        <span>{"}"}</span>
      </span>
    )
  }
  return <span>{String(value)}</span>
}
