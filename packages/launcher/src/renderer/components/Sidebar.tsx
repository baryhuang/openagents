import React from "react"
import { cn } from "../lib/utils"
import { useUiStore } from "../store/ui"
import { useAgentsStore, useDaemonStatus } from "../store/agents"
import { useShallow } from "zustand/react/shallow"

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "●" },
  { id: "agents",    label: "Agents",    icon: "⚙" },
  { id: "install",   label: "Install",   icon: "↓" },
  { id: "logs",      label: "Logs",      icon: "☰" },
  { id: "settings",  label: "Settings",  icon: "⚙" },
]

export default function Sidebar(): React.JSX.Element {
  const { currentTab, setCurrentTab, goToInstallList } = useUiStore(
    useShallow((s) => ({
      currentTab: s.currentTab,
      setCurrentTab: s.setCurrentTab,
      goToInstallList: s.goToInstallList,
    })),
  )
  const { coreVersion, launcherVersion, coreUpdateInfo } = useAgentsStore(
    useShallow((s) => ({ coreVersion: s.coreVersion, launcherVersion: s.launcherVersion, coreUpdateInfo: s.coreUpdateInfo })),
  )
  const daemonStatus = useDaemonStatus()

  const daemonLabel =
    daemonStatus === "online"   ? "Daemon: running"  :
    daemonStatus === "starting" ? "Daemon: starting" :
                                  "Daemon: offline"

  return (
    <aside
      className={cn(
        "w-(--sidebar-width) shrink-0 h-screen",
        "bg-(--bg-sidebar) border-r border-(--border)",
        "flex flex-col sidebar-drag",
      )}
    >
      <div className="px-5 pt-6 pb-4">
        <h2 className="text-[13px] font-bold tracking-[-0.02em] text-(--text-primary) m-0">
          OpenAgents Launcher
        </h2>
      </div>

      <ul className="list-none m-0 px-2.5 flex-1 sidebar-no-drag">
        {NAV_ITEMS.map((item) => {
          const active = currentTab === item.id
          return (
            <li key={item.id} className="m-0">
              <button
                type="button"
                onClick={() => item.id === "install" ? goToInstallList() : setCurrentTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 mb-[2px]",
                  "rounded-sm text-[13px] font-medium text-left cursor-pointer",
                  "transition-all duration-180 ease-(--ease)",
                  "border-0 bg-transparent",
                  active
                    ? "bg-(--accent) text-white shadow-[0_2px_6px_rgba(88,86,214,0.25)]"
                    : "text-(--text-secondary) hover:bg-(--bg-primary) hover:text-(--text-primary)",
                )}
              >
                <span className={cn("w-[18px] text-center text-[14px] inline-block", active ? "opacity-100" : "opacity-55")}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="px-[18px] py-[14px] border-t border-(--border) sidebar-no-drag">
        {coreUpdateInfo && (
          <div className="mb-2 rounded-md border border-[#6C63FF] bg-[#EEF2FF] px-2.5 py-2 text-[11px]">
            <div className="font-semibold text-[#6C63FF] mb-1">Update available</div>
            <div className="text-[#666] mb-1.5">
              v{coreUpdateInfo.current} → v{coreUpdateInfo.latest}
            </div>
            <button
              type="button"
              className="w-full rounded-sm bg-(--accent) text-white py-1 px-2 text-[11px] font-semibold cursor-pointer border-0 transition-colors hover:bg-(--accent-hover)"
              onClick={async () => {
                try {
                  const result = await window.api.updateCore()
                  if (!result.success) console.error("Update failed:", result.error)
                } catch (e) {
                  console.error("Update error:", e)
                }
              }}
            >
              Update Now
            </button>
          </div>
        )}
        <div className="flex flex-col gap-[2px] mb-[10px]">
          <span className="text-[10px] text-(--text-tertiary) opacity-70">
            Launcher: {launcherVersion ?? "--"}
          </span>
          <span className="text-[10px] text-(--text-tertiary) opacity-70">
            Core: {coreVersion ? `v${coreVersion}` : "--"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-medium text-(--text-tertiary)" title="Daemon status">
          <span className={cn(
            "inline-block w-[7px] h-[7px] rounded-full shrink-0",
            daemonStatus === "online"   && "bg-(--success) shadow-[0_0_0_3px_rgba(48,209,88,0.15)]",
            daemonStatus === "starting" && "bg-(--warning) animate-[pulse-dot_1.5s_infinite]",
            daemonStatus === "offline"  && "bg-(--text-tertiary)",
          )} />
          <span>{daemonLabel}</span>
        </div>
      </div>
    </aside>
  )
}
