import React from "react"
import {
  LayoutDashboard,
  MessageSquare,
  Cpu,
  Layers,
  Plug,
  KeyRound,
  Github,
  Download,
  FileText,
  Settings as SettingsIcon,
  Bell,
  Moon,
  Sun,
  Monitor,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { cn } from "../lib/utils"
import { useUiStore } from "../store/ui"
import { useAgentsStore, useDaemonStatus } from "../store/agents"
import { useInstallStore } from "../store/install"
import { useNotificationsStore } from "../store/notifications"
import { useThemeStore, type ThemeMode } from "../store/theme"
import { useUpdateDismissals } from "../hooks/useUpdateDismissals"

type SectionId = "overview" | "manage" | "system"

interface NavItem {
  id: string
  label: string
  icon: React.JSX.Element
  section: SectionId
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" />, section: "overview" },
  { id: "chat", label: "Chat", icon: <MessageSquare className="w-4 h-4" />, section: "overview" },

  { id: "install", label: "Marketplace", icon: <Download className="w-4 h-4" />, section: "manage" },
  { id: "agents", label: "Agents", icon: <Cpu className="w-4 h-4" />, section: "manage" },
  { id: "workspaces", label: "Workspaces", icon: <Layers className="w-4 h-4" />, section: "manage" },
  { id: "connections", label: "Connections", icon: <Plug className="w-4 h-4" />, section: "manage" },
  { id: "credentials", label: "Credentials", icon: <KeyRound className="w-4 h-4" />, section: "manage" },
  { id: "github", label: "GitHub", icon: <Github className="w-4 h-4" />, section: "manage" },

  { id: "logs", label: "Logs", icon: <FileText className="w-4 h-4" />, section: "system" },
  { id: "settings", label: "Settings", icon: <SettingsIcon className="w-4 h-4" />, section: "system" },
]

const SECTION_LABELS: Record<SectionId, string> = {
  overview: "Overview",
  manage: "Manage",
  system: "System",
}

export default function Sidebar(): React.JSX.Element {
  const { currentTab, setCurrentTab, goToInstallList } = useUiStore(
    useShallow((s) => ({
      currentTab: s.currentTab,
      setCurrentTab: s.setCurrentTab,
      goToInstallList: s.goToInstallList,
    })),
  )
  const launcherVersion = useAgentsStore((s) => s.launcherVersion)
  const updates = useInstallStore((s) => s.updates)
  const { isDismissed } = useUpdateDismissals()
  const daemonStatus = useDaemonStatus()

  const updateCount = updates.filter(
    (u) =>
      u.current &&
      u.latest &&
      u.current !== u.latest &&
      !isDismissed(u.name, u.latest),
  ).length

  const badges: Record<string, number | undefined> = {
    install: updateCount > 0 ? updateCount : undefined,
  }

  const daemonLabel =
    daemonStatus === "running"
      ? "Daemon running"
      : daemonStatus === "starting"
        ? "Daemon starting"
        : daemonStatus === "stopped"
          ? "Daemon stopped"
          : "Daemon offline"

  const sections: SectionId[] = ["overview", "manage", "system"]

  return (
    <aside
      data-sidebar="dark"
      className={cn(
        "w-(--sidebar-width) shrink-0 h-screen",
        "flex flex-col sidebar-drag",
        "select-none",
      )}
      style={{
        background: "#0e1117",
        borderRight: "1px solid rgba(255,255,255,0.04)",
        color: "#c1c2cb",
      }}
    >
      {/* Brand */}
      <div className="px-4 pt-5 pb-4 sidebar-no-drag">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0"
            style={{
              background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
              boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
            }}
          >
            OA
          </div>
          <span
            className="text-[14px] font-semibold tracking-tight text-white truncate"
            title="OpenAgents"
          >
            OpenAgents
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 sidebar-no-drag">
        {sections.map((section) => {
          const items = NAV_ITEMS.filter((i) => i.section === section)
          return (
            <div key={section} className="mb-5 last:mb-0">
              <div
                className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: "#5a5e6b" }}
              >
                {SECTION_LABELS[section]}
              </div>
              <ul className="m-0 p-0 list-none">
                {items.map((item) => {
                  const active = currentTab === item.id
                  const badge = badges[item.id]
                  return (
                    <li key={item.id} className="m-0">
                      <button
                        type="button"
                        onClick={() =>
                          item.id === "install"
                            ? goToInstallList()
                            : setCurrentTab(item.id)
                        }
                        className={cn(
                          "group w-full flex items-center gap-2.5 px-2.5 py-2 mb-[1px]",
                          "rounded-md text-[13px] font-medium text-left cursor-pointer",
                          "transition-colors duration-100",
                          "border-0",
                        )}
                        style={{
                          background: active ? "#1a1d2a" : "transparent",
                          color: active ? "#ffffff" : "#a8aabb",
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            ;(e.currentTarget as HTMLButtonElement).style.background = "#15171f"
                            ;(e.currentTarget as HTMLButtonElement).style.color = "#e5e6ed"
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            ;(e.currentTarget as HTMLButtonElement).style.background = "transparent"
                            ;(e.currentTarget as HTMLButtonElement).style.color = "#a8aabb"
                          }
                        }}
                      >
                        <span
                          className="shrink-0"
                          style={{ opacity: active ? 1 : 0.75 }}
                        >
                          {item.icon}
                        </span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {badge !== undefined && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 text-white"
                            style={{ background: "#6366f1" }}
                          >
                            {badge}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Footer: bell + theme strip, then daemon status + version */}
      <div
        className="px-3 py-2 sidebar-no-drag flex items-center gap-1"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        <NotificationBellDark />
        <ThemeToggleDark />
      </div>
      <div
        className="px-4 pt-2 pb-3 sidebar-no-drag flex items-center gap-2 text-[11px]"
        style={{ color: "#7a7e8c" }}
        title={daemonLabel}
      >
        <span
          className={cn(
            "inline-block w-[7px] h-[7px] rounded-full shrink-0",
            daemonStatus === "starting" && "animate-[pulse-dot_1.5s_infinite]",
          )}
          style={{
            background:
              daemonStatus === "running"
                ? "#22c55e"
                : daemonStatus === "starting"
                  ? "#f59e0b"
                  : daemonStatus === "stopped"
                    ? "#f59e0b"
                    : "#6b7280",
            boxShadow:
              daemonStatus === "running"
                ? "0 0 0 3px rgba(34,197,94,0.15)"
                : undefined,
          }}
        />
        <span className="truncate">{daemonLabel}</span>
        <span className="opacity-60">·</span>
        <span className="opacity-60 truncate">{launcherVersion || "v?"}</span>
      </div>
    </aside>
  )
}

// ── Dark-themed bell + theme toggle for the sidebar header ──────────────────

function NotificationBellDark(): React.JSX.Element {
  const { items, unread, markRead, markAllRead, clear } =
    useNotificationsStore(
      useShallow((s) => ({
        items: s.items,
        unread: s.unread,
        markRead: s.markRead,
        markAllRead: s.markAllRead,
        clear: s.clear,
      })),
    )
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const [open, setOpen] = React.useState(false)
  const popoverRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const recent = items.slice(0, 30)

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className="relative w-7 h-7 rounded-md flex items-center justify-center cursor-pointer border-0 bg-transparent transition-colors"
        style={{ color: "#a8aabb" }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = "#15171f"
          ;(e.currentTarget as HTMLButtonElement).style.color = "#ffffff"
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = "transparent"
          ;(e.currentTarget as HTMLButtonElement).style.color = "#a8aabb"
        }}
      >
        <Bell className="w-3.5 h-3.5" />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full text-[9px] font-bold leading-[14px] text-center text-white"
            style={{ background: "#ef4444" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className={cn(
            "absolute left-0 top-[calc(100%+8px)] z-50",
            "w-[340px] max-h-[460px]",
            "bg-(--bg-card) border border-(--border) rounded-(--radius)",
            "shadow-(--shadow-lg) overflow-hidden flex flex-col",
          )}
          style={{ color: "var(--text-primary)" }}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-(--border)">
            <div className="text-[13px] font-semibold text-(--text-primary)">
              Notifications
              {unread > 0 && (
                <span className="ml-1.5 text-[11px] text-(--text-tertiary) font-normal">
                  {unread} unread
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  className="text-[11px] text-(--text-secondary) hover:text-(--text-primary) bg-transparent border-0 cursor-pointer"
                >
                  Mark all read
                </button>
              )}
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => clear()}
                  className="text-[11px] text-(--text-secondary) hover:text-(--text-primary) bg-transparent border-0 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-(--text-tertiary)">
                No notifications yet.
              </div>
            ) : (
              <ul className="m-0 p-0 list-none">
                {recent.map((r) => (
                  <li
                    key={r.id}
                    onClick={() => {
                      if (!r.read) void markRead(r.id)
                      if (r.payload && typeof r.payload.tab === "string") {
                        setCurrentTab(r.payload.tab as string)
                        setOpen(false)
                      }
                    }}
                    className={cn(
                      "px-3 py-2 border-b border-(--border) cursor-pointer hover:bg-(--bg-input)",
                      !r.read && "bg-(--accent-bg)",
                    )}
                  >
                    <div className="text-[12px] font-medium text-(--text-primary) truncate">
                      {r.title}
                    </div>
                    <div className="text-[11px] text-(--text-secondary) line-clamp-2 mt-0.5">
                      {r.body}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ThemeToggleDark(): React.JSX.Element {
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )
  const next: ThemeMode =
    mode === "light" ? "dark" : mode === "dark" ? "system" : "light"
  const Icon = mode === "dark" ? Moon : mode === "system" ? Monitor : Sun
  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      title={`Theme: ${mode} — click for ${next}`}
      aria-label="Toggle theme"
      className="w-7 h-7 rounded-md flex items-center justify-center cursor-pointer border-0 bg-transparent transition-colors"
      style={{ color: "#a8aabb" }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = "#15171f"
        ;(e.currentTarget as HTMLButtonElement).style.color = "#ffffff"
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = "transparent"
        ;(e.currentTarget as HTMLButtonElement).style.color = "#a8aabb"
      }}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}
