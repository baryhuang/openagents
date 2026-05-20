import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactDOM from "react-dom"
import {
  Search,
  LayoutDashboard,
  MessageSquare,
  Settings as SettingsIcon,
  Layers,
  Plug,
  KeyRound,
  Github,
  FileText,
  Download,
  Play,
  Square,
  Plus,
  Folder,
  Moon,
  Sun,
  Monitor,
  Cpu,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useUiStore } from "../../store/ui"
import { useAgentsStore } from "../../store/agents"
import { useThemeStore, type ThemeMode } from "../../store/theme"
import { cn } from "../../lib/utils"

const HISTORY_KEY = "launcher:command-history"
const MAX_HISTORY = 10

export interface Command {
  id: string
  title: string
  subtitle?: string
  group: string
  keywords?: string
  icon?: React.JSX.Element
  shortcut?: string
  run: () => void | Promise<void>
}

function score(query: string, cmd: Command): number {
  if (!query) return 1
  const q = query.toLowerCase().trim()
  const hay = `${cmd.title} ${cmd.subtitle || ""} ${cmd.group} ${cmd.keywords || ""}`.toLowerCase()
  if (hay.includes(q)) return 2
  // Fuzzy: every char of q appears in hay in order
  let i = 0
  for (const ch of hay) {
    if (ch === q[i]) i += 1
    if (i === q.length) return 1
  }
  return 0
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string").slice(0, MAX_HISTORY) : []
  } catch {
    return []
  }
}

function pushHistory(id: string): void {
  try {
    const prev = loadHistory().filter((s) => s !== id)
    const next = [id, ...prev].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {}
}

export function CommandPalette(): React.JSX.Element | null {
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const goToInstallList = useUiStore((s) => s.goToInstallList)
  const setInstallFocusAgent = useUiStore((s) => s.setInstallFocusAgent)
  const agents = useAgentsStore((s) => s.agents)
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Global hotkey (Cmd/Ctrl+K)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")
      if (isCmdK) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  // Build commands
  const commands: Command[] = useMemo(() => {
    const navTabs: Array<[string, string, React.JSX.Element]> = [
      ["dashboard", "Dashboard", <LayoutDashboard key="d" className="w-3.5 h-3.5" />],
      ["chat", "Chat", <MessageSquare key="c" className="w-3.5 h-3.5" />],
      ["agents", "Agents", <Cpu key="a" className="w-3.5 h-3.5" />],
      ["workspaces", "Workspaces", <Layers key="w" className="w-3.5 h-3.5" />],
      ["connections", "Connections", <Plug key="cn" className="w-3.5 h-3.5" />],
      ["credentials", "Credentials", <KeyRound key="k" className="w-3.5 h-3.5" />],
      ["github", "GitHub", <Github key="g" className="w-3.5 h-3.5" />],
      ["install", "Install", <Download key="i" className="w-3.5 h-3.5" />],
      ["logs", "Logs", <FileText key="l" className="w-3.5 h-3.5" />],
      ["settings", "Settings", <SettingsIcon key="s" className="w-3.5 h-3.5" />],
    ]

    const navCmds: Command[] = navTabs.map(([id, label, icon]) => ({
      id: `nav:${id}`,
      title: `Go to ${label}`,
      group: "Navigation",
      icon,
      run: () => {
        if (id === "install") goToInstallList()
        else setCurrentTab(id)
      },
    }))

    const agentCmds: Command[] = []
    for (const a of agents) {
      const isRunning = ["online", "running", "idle"].includes(a.state)
      agentCmds.push({
        id: `agent:open:${a.name}`,
        title: `Open agent: ${a.name}`,
        subtitle: a.type,
        group: "Agents",
        icon: <Cpu className="w-3.5 h-3.5" />,
        run: () => {
          setCurrentTab("agents")
          setInstallFocusAgent(a.name)
        },
      })
      if (isRunning) {
        agentCmds.push({
          id: `agent:stop:${a.name}`,
          title: `Stop agent: ${a.name}`,
          group: "Agents",
          icon: <Square className="w-3.5 h-3.5" />,
          run: () => void window.api.stopAgent(a.name),
        })
      } else {
        agentCmds.push({
          id: `agent:start:${a.name}`,
          title: `Start agent: ${a.name}`,
          group: "Agents",
          icon: <Play className="w-3.5 h-3.5" />,
          run: () => void window.api.startAgent(a.name),
        })
      }
    }

    const actionCmds: Command[] = [
      {
        id: "action:start-all",
        title: "Start all agents",
        group: "Actions",
        icon: <Play className="w-3.5 h-3.5" />,
        run: () => void window.api.startAll(),
      },
      {
        id: "action:stop-all",
        title: "Stop all agents",
        group: "Actions",
        icon: <Square className="w-3.5 h-3.5" />,
        run: () => void window.api.stopAll(),
      },
      {
        id: "action:install-agent",
        title: "Install new agent",
        group: "Actions",
        icon: <Plus className="w-3.5 h-3.5" />,
        run: () => goToInstallList(),
      },
      {
        id: "action:new-workspace",
        title: "New workspace",
        group: "Actions",
        icon: <Folder className="w-3.5 h-3.5" />,
        run: () => setCurrentTab("workspaces"),
      },
    ]

    const themeCmds: Command[] = (["light", "dark", "system"] as ThemeMode[]).map((t) => ({
      id: `theme:${t}`,
      title: `Theme: ${t[0].toUpperCase()}${t.slice(1)}`,
      group: "Appearance",
      icon:
        t === "dark" ? (
          <Moon className="w-3.5 h-3.5" />
        ) : t === "light" ? (
          <Sun className="w-3.5 h-3.5" />
        ) : (
          <Monitor className="w-3.5 h-3.5" />
        ),
      subtitle: mode === t ? "Current" : undefined,
      run: () => setMode(t),
    }))

    return [...navCmds, ...agentCmds, ...actionCmds, ...themeCmds]
  }, [agents, setCurrentTab, goToInstallList, setInstallFocusAgent, mode, setMode])

  const ranked = useMemo(() => {
    if (!query.trim()) {
      const history = loadHistory()
      const byId = new Map(commands.map((c) => [c.id, c]))
      const recent = history
        .map((id) => byId.get(id))
        .filter((c): c is Command => !!c)
        .map((c) => ({ ...c, group: "Recent" }))
      const seen = new Set(recent.map((c) => c.id))
      return [...recent, ...commands.filter((c) => !seen.has(c.id))]
    }
    return commands
      .map((c) => ({ c, s: score(query, c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
  }, [query, commands])

  // Group rendering — collapse to flat array but track group changes for headers
  const grouped = useMemo(() => {
    const out: Array<{ type: "header"; group: string } | { type: "item"; cmd: Command; index: number }> = []
    let last = ""
    let idx = 0
    for (const c of ranked) {
      if (c.group !== last) {
        out.push({ type: "header", group: c.group })
        last = c.group
      }
      out.push({ type: "item", cmd: c, index: idx })
      idx += 1
    }
    return out
  }, [ranked])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector(
      `[data-cmd-idx="${activeIdx}"]`,
    ) as HTMLElement | null
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [activeIdx, open])

  const execute = useCallback(
    async (cmd: Command) => {
      pushHistory(cmd.id)
      close()
      try {
        await cmd.run()
      } catch (err) {
        console.error("Command failed:", err)
      }
    },
    [close],
  )

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, ranked.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const cmd = ranked[activeIdx]
      if (cmd) void execute(cmd)
    }
  }

  if (!open) return null

  return ReactDOM.createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 2000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        className={cn(
          "w-[640px] max-w-[90vw] max-h-[60vh]",
          "bg-(--bg-card) border border-(--border) rounded-(--radius-lg) shadow-(--shadow-lg)",
          "flex flex-col overflow-hidden",
        )}
        style={{ animation: "modalIn 0.18s var(--ease)" }}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-(--border)">
          <Search className="w-4 h-4 text-(--text-tertiary)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command, agent, or page…"
            className="flex-1 bg-transparent border-0 outline-none text-[14px] text-(--text-primary) placeholder:text-(--text-tertiary)"
          />
          <kbd className="text-[10px] text-(--text-tertiary) bg-(--bg-input) px-1.5 py-0.5 rounded-sm">
            ESC
          </kbd>
        </div>

        <ul
          ref={listRef}
          className="m-0 p-1 list-none flex-1 overflow-y-auto"
        >
          {grouped.length === 0 && (
            <li className="px-4 py-6 text-center text-[12px] text-(--text-tertiary)">
              No commands match.
            </li>
          )}
          {grouped.map((entry, i) =>
            entry.type === "header" ? (
              <li
                key={`h:${entry.group}:${i}`}
                className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-(--text-tertiary) font-semibold"
              >
                {entry.group}
              </li>
            ) : (
              <li
                key={entry.cmd.id}
                data-cmd-idx={entry.index}
                onClick={() => execute(entry.cmd)}
                onMouseMove={() => setActiveIdx(entry.index)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-sm cursor-pointer text-[12px]",
                  entry.index === activeIdx
                    ? "bg-(--accent) text-white"
                    : "text-(--text-primary) hover:bg-(--bg-input)",
                )}
              >
                <span className="shrink-0 opacity-80">{entry.cmd.icon}</span>
                <span className="flex-1 truncate">{entry.cmd.title}</span>
                {entry.cmd.subtitle && (
                  <span
                    className={cn(
                      "text-[11px] shrink-0",
                      entry.index === activeIdx
                        ? "text-white/80"
                        : "text-(--text-tertiary)",
                    )}
                  >
                    {entry.cmd.subtitle}
                  </span>
                )}
              </li>
            ),
          )}
        </ul>

        <div className="flex items-center justify-between px-3 py-2 border-t border-(--border) text-[10px] text-(--text-tertiary)">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="bg-(--bg-input) px-1 py-0.5 rounded-sm mr-1">↑↓</kbd>
              Navigate
            </span>
            <span>
              <kbd className="bg-(--bg-input) px-1 py-0.5 rounded-sm mr-1">⏎</kbd>
              Run
            </span>
          </div>
          <span>
            <kbd className="bg-(--bg-input) px-1 py-0.5 rounded-sm mr-1">⌘K</kbd>
            Toggle
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
