import React, { useEffect, useState, useCallback, useRef } from "react"
import { Switch } from "../../components/ui/Switch"
import { Label } from "../../components/ui/Label"
import { Separator } from "../../components/ui/Separator"
import type { RuntimeInfo } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface SettingsProps {
  showToast: (msg: string, type?: ToastType) => void
}

export default function Settings(_props: SettingsProps): React.JSX.Element {
  const [startOnBoot, setStartOnBoot] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
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
    loadRuntime()
    const id = setInterval(loadRuntime, 5000)
    return () => clearInterval(id)
  }, [loadSettings, loadRuntime, loadLauncherVersion])

  const handleStartOnBoot = async (checked: boolean): Promise<void> => {
    setStartOnBoot(checked)
    await window.api.setSetting("startOnBoot", checked)
  }

  const handleMinimizeToTray = async (checked: boolean): Promise<void> => {
    setMinimizeToTray(checked)
    await window.api.setSetting("minimizeToTray", checked)
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
