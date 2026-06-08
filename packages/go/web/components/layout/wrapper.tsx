'use client';

// Two-pane layout mirroring Swift's `NavigationSplitView`:
//   [ ThreadListPanel (~300px) | ChatView (fills) ]
// Right inspector (Content + Browser tabs) is a third inline panel that
// hangs off the chat column, identical to the Swift `ContentSidebar`.
// Mobile collapses to single-pane with push-pop between list and detail.

import { Sidebar } from './sidebar';
import { MobileHeader } from './mobile-header';
import { useLayout } from './layout-context';
import { ChatView } from '@/components/chat/chat-view';
import { AgentProfilePanel } from '@/components/agents/agent-profile-panel';
import { MonitorGrid } from '@/components/monitor/monitor-grid';
import { BrowserView } from '@/components/browser/browser-view';
import { RightTabbedPanel } from './right-tabbed-panel';
import { useWorkspace } from '@/lib/workspace-context';

function WorkspaceLoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <img
          src="/logo-icon.png"
          alt="OpenAgents"
          className="size-16 animate-[pulse_2s_ease-in-out_infinite]"
        />
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">OpenAgents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Workspace</p>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted overflow-hidden">
        <div className="h-full w-1/3 bg-primary rounded-full animate-[loading-bar_1.5s_ease-in-out_infinite]" />
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

export function Wrapper() {
  const {
    isMobile,
    isAgentPanelOpen,
    isSidebarOpen,
    isDetailExpanded,
    mobilePane,
    splitBrowser,
    showBrowserPreview,
  } = useLayout();
  const { monitorMode, loading } = useWorkspace();

  if (loading) {
    return <WorkspaceLoadingScreen />;
  }

  // ─── Mobile: single-pane push/pop ──────────────────────────────
  // Swift's NavigationSplitView collapses to NavigationStack on
  // compact-width. We mirror that: list pane (the same sidebar content)
  // OR detail pane (chat + optional file preview / browser overlay).
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen w-full [&_.container-fluid]:px-5">
        <MobileHeader />
        <div className="flex-1 min-h-0 pt-[var(--header-height-mobile)]">
          {mobilePane === 'list' ? (
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs flex flex-col">
              <Sidebar />
            </div>
          ) : (
            <div className="relative h-full bg-background overflow-hidden">
              <main className="h-full" role="content">
                <ChatView />
              </main>
              {/* Right-panel content for mobile uses the same components
                  as desktop but rendered as a full-screen overlay. */}
              <RightTabbedPanel />
              {isAgentPanelOpen && <AgentProfilePanel />}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Desktop: 2-pane (thread list | chat) + right inspector ────
  return (
    <div className="flex h-screen w-full [&_.container-fluid]:px-5">
      {!isDetailExpanded && <Sidebar />}

      <div className="flex flex-col flex-1 min-w-0 w-full">
        <div className="flex grow min-h-0 overflow-hidden mx-2.5 py-2.5 gap-2.5">
          {/* Spacer matching the fixed sidebar's width so the chat column
              doesn't overlap it. Mirrors how NavigationSplitView reserves
              the sidebar column's width on macOS. */}
          {!isDetailExpanded && (
            <div
              className="shrink-0 transition-all duration-300"
              style={{
                width: isSidebarOpen
                  ? 'var(--sidebar-width)'
                  : 'var(--sidebar-width-collapsed)',
              }}
            />
          )}

          {monitorMode ? (
            <div className="relative flex-1 min-w-0">
              <MonitorGrid />
              {isAgentPanelOpen && <AgentProfilePanel />}
            </div>
          ) : splitBrowser && showBrowserPreview ? (
            <div className="flex flex-1 min-w-0 gap-2.5">
              <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
                <main className="h-full" role="content">
                  <ChatView />
                </main>
                {isAgentPanelOpen && <AgentProfilePanel />}
              </div>
              <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
                <BrowserView />
              </div>
            </div>
          ) : (
            <>
              <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
                <main className="h-full" role="content">
                  <ChatView />
                </main>
                {isAgentPanelOpen && <AgentProfilePanel />}
              </div>
              <RightTabbedPanel />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

