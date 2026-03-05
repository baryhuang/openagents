'use client';

import { Sidebar } from './sidebar';
import { MobileHeader } from './mobile-header';
import { useLayout } from './layout-context';
import { ChatView } from '@/components/chat/chat-view';
import { ThreadList } from '@/components/threads/thread-list';
import { FileList } from '@/components/files/file-list';
import { FilePreview } from '@/components/files/file-preview';
import { BrowserTabList } from '@/components/browser/browser-tab-list';
import { BrowserView } from '@/components/browser/browser-view';
import { ConnectAgentView } from '@/components/connect/connect-agent-view';
import { AgentProfilePanel } from '@/components/agents/agent-profile-panel';

export function Wrapper() {
  const { isMobile, viewMode, isAgentPanelOpen, isSidebarOpen } = useLayout();

  return (
    <div className="flex h-screen w-full [&_.container-fluid]:px-5">
      {!isMobile && <Sidebar />}

      <div className="flex flex-col flex-1 min-w-0 w-full pt-[var(--header-height-mobile)] lg:pt-0">
        {isMobile && <MobileHeader />}
        <div className="flex grow min-h-0 overflow-hidden lg:mx-2.5 mx-5 py-2.5 gap-2.5">
          {/* Invisible spacer for fixed sidebar */}
          <div
            className="hidden lg:block shrink-0 transition-all duration-300"
            style={{
              width: isSidebarOpen
                ? 'var(--sidebar-width)'
                : 'var(--sidebar-width-collapsed)',
            }}
          />

          {/* Middle pane — thread list or file list (hidden for connect view) */}
          {viewMode !== 'connect' && (
            <div className="shrink-0 w-[300px] xl:w-[400px] bg-background overflow-hidden border border-input rounded-xl shadow-xs flex flex-col">
              {viewMode === 'threads' && <ThreadList />}
              {viewMode === 'files' && <FileList />}
              {viewMode === 'browser' && <BrowserTabList />}
            </div>
          )}

          {/* Right pane — chat view, file preview, or connect agent */}
          <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
            {viewMode === 'threads' && (
              <main className="h-full" role="content">
                <ChatView />
              </main>
            )}
            {viewMode === 'files' && <FilePreview />}
            {viewMode === 'browser' && <BrowserView />}
            {viewMode === 'connect' && <ConnectAgentView />}

            {/* Agent profile slide-over */}
            {isAgentPanelOpen && <AgentProfilePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
