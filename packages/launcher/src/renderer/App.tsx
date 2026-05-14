import React, { useEffect } from "react"
import { useUiStore } from "./store/ui"
import { useAgentsStore } from "./store/agents"
import Sidebar from "./components/Sidebar"
import { ToastContainer } from "./components/ui/Toast"
import Dashboard from "./pages/Dashboard"
import Agents from "./pages/Agents"
import Install from "./pages/Install"
import Logs from "./pages/Logs"
import Settings from "./pages/Settings"
import { useToasts } from "./hooks/useToast"

export default function App(): React.JSX.Element {
  const currentTab = useUiStore((s) => s.currentTab)
  const setCoreUpdateInfo = useAgentsStore((s) => s.setCoreUpdateInfo)
  const { showToast } = useToasts()

  useEffect(() => {
    window.api.onCoreUpdate((info) => {
      setCoreUpdateInfo(info)
    })
  }, [setCoreUpdateInfo])

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

      <ToastContainer />
    </div>
  )
}
