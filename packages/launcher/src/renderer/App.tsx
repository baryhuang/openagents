import React, { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { useUiStore } from "./store/ui"
import { useAgentsStore } from "./store/agents"
import { useInstallStore } from "./store/install"
import { useThemeStore } from "./store/theme"
import { useNotificationsStore } from "./store/notifications"
import Sidebar from "./components/Sidebar"
import { ToastContainer } from "./components/ui/Toast"
import { CommandPalette } from "./components/command-palette/CommandPalette"
import { OnboardingFlow, shouldShowOnboarding } from "./components/onboarding/OnboardingFlow"
import Dashboard from "./pages/dashboard"
import Agents from "./pages/agents"
import Chat from "./pages/chat"
import Workspaces from "./pages/workspaces"
import Connections from "./pages/connections"
import Credentials from "./pages/credentials"
import GitHubPage from "./pages/github"
import Install from "./pages/install"
import Logs from "./pages/logs"
import Settings from "./pages/settings"
import { InstallMiniBanner } from "./components/install-progress/StagedProgress"
import { useToasts } from "./hooks/useToast"
import { useInstallProgress } from "./hooks/useInstallProgress"
import { cn } from "./lib/utils"

export default function App(): React.JSX.Element {
  const currentTab = useUiStore((s) => s.currentTab)
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const setCoreUpdateInfo = useAgentsStore((s) => s.setCoreUpdateInfo)
  const initTheme = useThemeStore((s) => s.init)
  const initNotifications = useNotificationsStore((s) => s.init)
  const { showToast } = useToasts()
  const [onboardingOpen, setOnboardingOpen] = React.useState(false)

  useEffect(() => {
    initTheme()
    void initNotifications()
    setOnboardingOpen(shouldShowOnboarding())
  }, [initTheme, initNotifications])

  // Global install:progress + install:output subscription
  useInstallProgress()

  const { jobs } = useInstallStore(useShallow((s) => ({ jobs: s.jobs })))

  useEffect(() => {
    window.api.onCoreUpdate((info) => setCoreUpdateInfo(info))
    window.api.onAgentUpdatesChanged((updates) =>
      useInstallStore.getState().setUpdates(updates),
    )
    window.api.onNavigateToInstall((name?: string) => {
      setCurrentTab("install")
      if (name) useUiStore.getState().setInstallFocusAgent(name)
    })
  }, [setCoreUpdateInfo, setCurrentTab])

  useEffect(() => {
    const tabs = [
      "dashboard",
      "agents",
      "workspaces",
      "connections",
      "credentials",
      "github",
      "install",
      "logs",
      "settings",
    ]
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1
        if (idx < tabs.length) {
          e.preventDefault()
          useUiStore.getState().setCurrentTab(tabs[idx])
        }
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

      <main
        className={cn(
          "flex-1 min-w-0 bg-(--bg-primary)",
          "overflow-hidden flex flex-col",
        )}
      >
        {currentTab === "dashboard" && (
          <Dashboard
            showToast={showToast}
            onOpenConfigure={() => {}}
            onOpenConnectWorkspace={() => {}}
          />
        )}
        {currentTab === "chat" && <Chat showToast={showToast} />}
        {currentTab === "agents" && <Agents showToast={showToast} />}
        {currentTab === "workspaces" && <Workspaces showToast={showToast} />}
        {currentTab === "connections" && <Connections showToast={showToast} />}
        {currentTab === "credentials" && <Credentials showToast={showToast} />}
        {currentTab === "github" && <GitHubPage showToast={showToast} />}
        {currentTab === "install" && <Install showToast={showToast} />}
        {currentTab === "logs" && <Logs showToast={showToast} />}
        {currentTab === "settings" && <Settings showToast={showToast} />}
      </main>

      {activeJob && currentTab !== "install" && (
        <InstallMiniBanner
          job={activeJob}
          onOpen={() => setCurrentTab("install")}
        />
      )}

      <ToastContainer />
      <CommandPalette />
      <OnboardingFlow
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        showToast={showToast}
      />
    </div>
  )
}
