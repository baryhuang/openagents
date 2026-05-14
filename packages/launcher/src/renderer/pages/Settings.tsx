import React, { useEffect, useState, useCallback, useRef } from "react"
import { Switch } from "../components/ui/Switch"
import { Label } from "../components/ui/Label"
import { Button } from "../components/ui/Button"
import { Separator } from "../components/ui/Separator"
import type { RuntimeInfo, Workspace } from "../types"
import type { ToastType } from "../hooks/useToast"

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
    } catch {}
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
    loadRuntime()
    loadWorkspaces()
    loadLauncherVersion()
    const interval = setInterval(() => {
      loadRuntime()
      loadWorkspaces()
    }, 5000)
    return () => clearInterval(interval)
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

  const runtimeRows: Array<{
    label: string
    value: string
    ok: boolean | null
  }> = [
    {
      label: "Node.js:",
      value: runtimeInfo?.nodeVersion || "Not installed",
      ok: runtimeInfo ? !!runtimeInfo.nodeVersion : null,
    },
    {
      label: "npm:",
      value: runtimeInfo?.npmVersion
        ? `v${runtimeInfo.npmVersion}`
        : "Not installed",
      ok: runtimeInfo ? !!runtimeInfo.npmVersion : null,
    },
    {
      label: "Core Library:",
      value: runtimeInfo?.coreVersion
        ? `v${runtimeInfo.coreVersion}`
        : "Not installed",
      ok: runtimeInfo ? !!runtimeInfo.coreVersion : null,
    },
    {
      label: "Latest Available:",
      value: runtimeInfo?.latestVersion
        ? `v${runtimeInfo.latestVersion}${
            runtimeInfo.coreVersion === runtimeInfo.latestVersion
              ? " (up to date)"
              : " (update available)"
          }`
        : "Unable to check",
      ok:
        runtimeInfo && runtimeInfo.latestVersion
          ? runtimeInfo.coreVersion === runtimeInfo.latestVersion
          : null,
    },
  ]

  const runtimeColor = (ok: boolean | null): string | undefined => {
    if (ok === null) return undefined
    if (ok === true) return "var(--success-text)"
    return "var(--danger-text)"
  }

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

      {/* Workspaces — legacy look */}
      <div className="card-legacy">
        <h3>Workspaces</h3>
        {workspaces.length === 0 ? (
          <span className="hint" style={{ marginBottom: 0 }}>
            No workspaces configured.
          </span>
        ) : (
          <ul className="workspace-url-list">
            {workspaces.map((ws) => {
              const slug = ws.slug || ws.id
              const name = ws.name || slug
              const url = `https://workspace.openagents.org/${slug}`
              const fullUrl = ws.token
                ? `${url}?token=${encodeURIComponent(ws.token)}`
                : url
              return (
                <li key={ws.id} className="workspace-url-item">
                  <span className="workspace-url-name">{name}</span>
                  <span
                    className="workspace-url-link"
                    onClick={() => window.api.openExternal(fullUrl)}
                  >
                    {url}
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeWorkspace(slug)}
                    style={{ marginLeft: 8 }}
                  >
                    Remove
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Runtime — legacy status rows */}
      <div className="card-legacy">
        <h3>Runtime</h3>
        {runtimeRows.map((row) => (
          <div key={row.label} className="status-row">
            <span>{row.label}</span>
            <span
              style={{
                color: runtimeColor(row.ok),
              }}
            >
              {runtimeInfo ? row.value : "Checking..."}
            </span>
          </div>
        ))}
      </div>

      {/* About — legacy */}
      <div className="card-legacy">
        <h3>About</h3>
        <p style={{ fontSize: 13, marginBottom: 8 }}>
          OpenAgents Launcher {launcherVersion}
        </p>
        <p style={{ fontSize: 13 }}>
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
