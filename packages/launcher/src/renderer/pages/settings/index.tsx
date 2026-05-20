import React, { useEffect, useState, useCallback, useRef } from "react"
import { Switch } from "../../components/ui/Switch"
import { Label } from "../../components/ui/Label"
import { Button } from "../../components/ui/Button"
import { Separator } from "../../components/ui/Separator"
import type { RuntimeInfo, Workspace } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface SettingsProps {
  showToast: (msg: string, type?: ToastType) => void
}

export default function Settings({
  showToast,
}: SettingsProps): React.JSX.Element {
  const [startOnBoot, setStartOnBoot] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [launcherVersion, setLauncherVersion] = useState<string>("--")
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const [boot, tray] = await Promise.all([
        window.api.getSetting("startOnBoot"),
        window.api.getSetting("minimizeToTray"),
      ])
      if (!mounted.current) return
      if (boot !== undefined) setStartOnBoot(!!boot)
      if (tray !== undefined) setMinimizeToTray(!!tray)
    } catch {}
  }, [])

  const loadRuntime = useCallback(async () => {
    try {
      const info = await window.api.runtimeInfo()
      if (mounted.current) setRuntimeInfo(info)
      return info
    } catch {
      return null
    }
  }, [])

  const loadWorkspaces = useCallback(async () => {
    try {
      const ws = await window.api.listWorkspaces()
      if (mounted.current) setWorkspaces(ws)
    } catch {}
  }, [])

  const loadLauncherVersion = useCallback(async () => {
    try {
      const status = await window.api.pythonStatus()
      if (mounted.current && status.launcherVersion)
        setLauncherVersion(`v${status.launcherVersion}`)
    } catch {}
  }, [])

  useEffect(() => {
    loadSettings()
    loadLauncherVersion()
    loadWorkspaces()
    loadRuntime()
    // Mirror legacy: refresh runtime + workspaces every 5s while Settings is mounted.
    const id = setInterval(() => {
      loadRuntime()
      loadWorkspaces()
    }, 5000)
    return () => clearInterval(id)
  }, [loadSettings, loadRuntime, loadWorkspaces, loadLauncherVersion])

  const handleStartOnBoot = async (checked: boolean): Promise<void> => {
    setStartOnBoot(checked)
    await window.api.setSetting("startOnBoot", checked)
  }

  const handleMinimizeToTray = async (checked: boolean): Promise<void> => {
    setMinimizeToTray(checked)
    await window.api.setSetting("minimizeToTray", checked)
  }

  const removeWorkspace = async (slug: string): Promise<void> => {
    if (
      !confirm(
        "This will remove the workspace locally and attempt to soft-delete it on the server.\nConnected agents will be disconnected.\n\nAre you sure?",
      )
    )
      return
    try {
      showToast("Removing workspace...", "info")
      await window.api.removeWorkspace(slug)
      showToast("Workspace removed", "success")
      loadWorkspaces()
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  // Mirror legacy refreshSettingsRuntime: text + green/red/warning color only.
  // "Checking..." while the first runtime:info hasn't returned.
  const runtimeRows: Array<{ label: string; value: string; color?: string }> = (() => {
    if (!runtimeInfo) {
      return [
        { label: "Node.js:", value: "Checking..." },
        { label: "npm:", value: "Checking..." },
        { label: "Core Library:", value: "Checking..." },
        { label: "Latest Available:", value: "Checking..." },
      ]
    }
    const upToDate =
      !!runtimeInfo.latestVersion && runtimeInfo.coreVersion === runtimeInfo.latestVersion
    return [
      {
        label: "Node.js:",
        value: runtimeInfo.nodeVersion || "Not installed",
        color: runtimeInfo.nodeVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: "npm:",
        value: runtimeInfo.npmVersion ? `v${runtimeInfo.npmVersion}` : "Not installed",
        color: runtimeInfo.npmVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: "Core Library:",
        value: runtimeInfo.coreVersion ? `v${runtimeInfo.coreVersion}` : "Not installed",
        color: runtimeInfo.coreVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: "Latest Available:",
        value: runtimeInfo.latestVersion
          ? `v${runtimeInfo.latestVersion}${upToDate ? " (up to date)" : " (update available)"}`
          : "Unable to check",
        color: runtimeInfo.latestVersion
          ? upToDate
            ? "var(--success-text)"
            : "var(--warning-text)"
          : undefined,
      },
    ]
  })()

  return (
    <section>
      <h1 className="mb-6">Settings</h1>

      {/* General — preserve launcher (modern) design */}
      <div className="card-legacy">
        <h3>General</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="start-on-boot"
              plain
              className="m-0 normal-case tracking-normal"
            >
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                Start on boot
              </span>
              <span className="block text-[11px] text-[var(--text-tertiary)] font-normal mt-0.5">
                Launch automatically when you log in
              </span>
            </Label>
            <Switch
              id="start-on-boot"
              checked={startOnBoot}
              onCheckedChange={handleStartOnBoot}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <Label
              htmlFor="minimize-to-tray"
              plain
              className="m-0 normal-case tracking-normal"
            >
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                Minimize to tray
              </span>
              <span className="block text-[11px] text-[var(--text-tertiary)] font-normal mt-0.5">
                Keep running in system tray when window is closed
              </span>
            </Label>
            <Switch
              id="minimize-to-tray"
              checked={minimizeToTray}
              onCheckedChange={handleMinimizeToTray}
            />
          </div>
        </div>
      </div>

      {/* Workspaces */}
      <div className="card-legacy">
        <h3>Workspaces</h3>
        {workspaces.length === 0 ? (
          <span className="hint mb-0">No workspaces configured.</span>
        ) : (
          <ul className="list-none p-0 m-0">
            {workspaces.map((ws) => {
              const slug = ws.slug || ws.id
              const name = ws.name || slug
              const url = `https://workspace.openagents.org/${slug}`
              const fullUrl = ws.token
                ? `${url}?token=${encodeURIComponent(ws.token)}`
                : url
              return (
                <li
                  key={ws.id}
                  className="flex justify-between items-center gap-2.5 py-2 text-xs border-b border-(--border) last:border-b-0"
                >
                  <span className="font-semibold text-(--text-primary)">{name}</span>
                  <span
                    className="text-[11px] text-(--text-link) cursor-pointer break-all hover:underline"
                    onClick={() => window.api.openExternal(fullUrl)}
                  >
                    {url}
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeWorkspace(slug)}
                    className="ml-2"
                  >
                    Remove
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Runtime */}
      <div className="card-legacy">
        <h3>Runtime</h3>
        {runtimeRows.map((row, idx) => (
          <div
            key={row.label}
            className={`flex justify-between items-center py-2.75 text-[13px] border-b border-(--border) ${idx === runtimeRows.length - 1 ? "border-b-0 mb-2" : ""}`}
          >
            <span>{row.label}</span>
            <span style={{ color: row.color }}>{row.value}</span>
          </div>
        ))}
      </div>

      {/* About */}
      <div className="card-legacy">
        <h3>About</h3>
        <p className="text-[13px] mb-2 flex items-center gap-1.5">
          OpenAgents Launcher {launcherVersion}
        </p>
        <p className="text-[13px]">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              window.api.openExternal("https://docs.openagents.com")
            }}
          >
            Documentation
          </a>
        </p>
      </div>
    </section>
  )
}
