import React, { useEffect, useRef, useCallback, useState } from "react"
import { Button } from "../components/ui/Button"
import { Modal, ModalTitle } from "../components/ui/Modal"
import { useAgentsStore } from "../store/agents"
import type { ToastType } from "../hooks/useToast"

const LOGS_INITIAL_LINES = 200
const LOGS_MAX_BUFFER = 400

interface LogsProps {
  showToast: (msg: string, type?: ToastType) => void
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (v: number): string => String(v).padStart(2, "0")
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("")
}

export default function Logs({ showToast }: LogsProps): React.JSX.Element {
  const agents = useAgentsStore((s) => s.agents)
  const [logLines, setLogLines] = useState<string[]>([])
  const [agentFilter, setAgentFilter] = useState("")
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearStart, setClearStart] = useState("")
  const [clearEnd, setClearEnd] = useState("")
  const [clearInFlight, setClearInFlight] = useState(false)
  const [clearError, setClearError] = useState("")

  const logsOffset = useRef(0)
  const filterRef = useRef("")
  const logViewerRef = useRef<HTMLPreElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refreshLogs = useCallback(async (reset = false) => {
    if (!mounted.current) return
    try {
      const filter = filterRef.current
      const shouldReset = reset || logsOffset.current === 0
      const result = await window.api.tailAgentLogs(
        filter,
        LOGS_INITIAL_LINES,
        shouldReset ? 0 : logsOffset.current,
      )
      if (!mounted.current) return
      logsOffset.current = result.size || 0
      if (shouldReset) {
        setLogLines(result.lines && result.lines.length > 0 ? result.lines : [])
        setTimeout(() => {
          if (logViewerRef.current)
            logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight
        }, 0)
      } else if (result.lines && result.lines.length > 0) {
        setLogLines((prev) => {
          const merged = [...prev, ...result.lines].slice(-LOGS_MAX_BUFFER)
          setTimeout(() => {
            if (logViewerRef.current)
              logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight
          }, 0)
          return merged
        })
      }
    } catch (err: unknown) {
      if (mounted.current)
        setLogLines([`Error loading logs: ${(err as Error).message}`])
    }
  }, [])

  useEffect(() => {
    logsOffset.current = 0
    refreshLogs(true)
  }, [refreshLogs])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => refreshLogs(false), 3000)
    return () => clearInterval(interval)
  }, [autoRefresh, refreshLogs])

  const handleFilterChange = (value: string): void => {
    setAgentFilter(value)
    filterRef.current = value
    logsOffset.current = 0
    refreshLogs(true)
  }

  const copyLogs = (): void => {
    navigator.clipboard
      .writeText(logLines.join("\n"))
      .then(() => showToast("Logs copied to clipboard", "success"))
      .catch(() => showToast("Failed to copy logs", "error"))
  }

  const openClearModal = (): void => {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    setClearStart(toDateTimeLocalValue(oneHourAgo))
    setClearEnd(toDateTimeLocalValue(now))
    setClearError("")
    setClearOpen(true)
  }

  const doClearLogs = async (): Promise<void> => {
    if (clearInFlight) return
    const start = clearStart ? new Date(clearStart) : null
    const end = clearEnd ? new Date(clearEnd) : null
    if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) {
      setClearError("Please select a valid start and end time.")
      return
    }
    if (start.getTime() > end.getTime()) {
      setClearError("Start time must be before end time.")
      return
    }
    setClearInFlight(true)
    setClearError("")
    try {
      const result = await window.api.clearLogsInRange(
        start.toISOString(),
        end.toISOString(),
      )
      setClearOpen(false)
      logsOffset.current = 0
      await refreshLogs(true)
      showToast(
        `Deleted ${result.removed || 0} log lines from the selected range`,
        "success",
      )
    } catch (err: unknown) {
      setClearError((err as Error).message || "Failed to clear logs.")
    } finally {
      setClearInFlight(false)
    }
  }

  return (
    <section className="flex flex-col h-full">
      <h1 className="mb-5">Logs</h1>

      <div className="log-controls">
        <select
          value={agentFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() => {
            logsOffset.current = 0
            refreshLogs(true)
          }}
        >
          Refresh
        </Button>
        <Button size="sm" onClick={openClearModal}>
          Clear Logs
        </Button>
        <Button size="sm" onClick={copyLogs}>
          Copy Logs
        </Button>
        <label
          className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] cursor-pointer"
          style={{ marginLeft: 4 }}
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          Auto-refresh
        </label>
      </div>

      <pre
        ref={logViewerRef}
        className="log-viewer flex-1"
        style={{ maxHeight: "calc(100vh - 200px)" }}
      >
        {logLines.length > 0
          ? logLines.join("\n")
          : "No logs available.\n\nLogs appear here after the daemon starts."}
      </pre>

      <Modal open={clearOpen} onClose={() => setClearOpen(false)}>
          <ModalTitle>Clear Logs</ModalTitle>
          <p className="hint">
            Delete log entries from <code className="inline-code">daemon.log</code>{" "}
            whose timestamps fall inside the selected time range.
          </p>
          <div className="form-group">
            <label htmlFor="clear-start">Start Time</label>
            <input
              id="clear-start"
              type="datetime-local"
              value={clearStart}
              onChange={(e) => setClearStart(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="clear-end">End Time</label>
            <input
              id="clear-end"
              type="datetime-local"
              value={clearEnd}
              onChange={(e) => setClearEnd(e.target.value)}
            />
          </div>
          {clearError && (
            <p
              style={{
                color: "var(--danger-text)",
                fontSize: 12,
                margin: "0 0 10px",
                minHeight: 18,
              }}
            >
              {clearError}
            </p>
          )}
          <div className="form-actions">
            <Button onClick={() => setClearOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={doClearLogs}
              disabled={clearInFlight}
            >
              {clearInFlight ? "Deleting..." : "Delete"}
            </Button>
          </div>
      </Modal>
    </section>
  )
}
