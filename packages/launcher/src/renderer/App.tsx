import React, { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { useUiStore } from "./store/ui"
import { useAgentsStore } from "./store/agents"
import { useInstallStore } from "./store/install"
import Sidebar from "./components/Sidebar"
import { ToastContainer } from "./components/ui/Toast"
import Dashboard from "./pages/dashboard"
import Agents from "./pages/agents"
import Install from "./pages/install"
import Logs from "./pages/logs"
import Settings from "./pages/settings"
import { InstallMiniBanner } from "./components/install-progress/StagedProgress"
import { useToasts } from "./hooks/useToast"
import { useInstallProgress } from "./hooks/useInstallProgress"

export default function App(): React.JSX.Element {
  const currentTab = useUiStore((s) => s.currentTab)
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const setCoreUpdateInfo = useAgentsStore((s) => s.setCoreUpdateInfo)
  const { showToast } = useToasts()

  // Global install:progress + install:output subscription
  useInstallProgress()

  const { jobs } = useInstallStore(useShallow((s) => ({ jobs: s.jobs })))

  useEffect(() => {
    window.api.onCoreUpdate((info) => setCoreUpdateInfo(info))
    window.api.onAgentUpdatesChanged((updates) => useInstallStore.getState().setUpdates(updates))
    window.api.onNavigateToInstall((name?: string) => {
      setCurrentTab("install")
      if (name) useUiStore.getState().setInstallFocusAgent(name)
    })
  }, [setCoreUpdateInfo, setCurrentTab])

  useEffect(() => {
    const tabs = ["dashboard", "agents", "install", "logs", "settings"]
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key >= "1" && e.key <= "5") {
        e.preventDefault()
        useUiStore.getState().setCurrentTab(tabs[parseInt(e.key) - 1])
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const activeJob = Object.values(jobs)
    .filter((j) => j.phase !== "done" && j.phase !== "error")
    .sort((a, b) => b.startedAt - a.startedAt)[0]

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar />

      <main className="flex-1 overflow-y-auto bg-[var(--bg-primary)] px-9 py-8">
        {currentTab === "dashboard" && (
          <Dashboard
            showToast={showToast}
            onOpenConfigure={() => {}}
            onOpenConnectWorkspace={() => {}}
          />
        )}
        {currentTab === "agents" && <Agents showToast={showToast} />}
        {currentTab === "install" && <Install showToast={showToast} />}
        {currentTab === "logs" && <Logs showToast={showToast} />}
        {currentTab === "settings" && <Settings showToast={showToast} />}
      </main>

      {activeJob && currentTab !== "install" && (
        <InstallMiniBanner job={activeJob} onOpen={() => setCurrentTab("install")} />
      )}

      <ToastContainer />
    </div>
  )
}
