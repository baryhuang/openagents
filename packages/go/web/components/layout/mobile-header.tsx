'use client';

// Mobile mirrors Swift's NavigationStack push/pop: tap a chat → push to
// detail; back chevron pops to list. The old bottom tab bar (Chats /
// Files / Browser / Tasks) is gone — Files and Browser live in the chat
// detail's right inspector, exactly like Swift's iPhone sheet-mode
// ContentSidebar.

import { ChevronLeft, SquarePen } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { useLayout } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';

export function MobileHeader() {
  const { mobilePane, openMobileList } = useLayout();
  const { workspace, createSession, sessions, currentSessionId } = useWorkspace();
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);

  const showingDetail = mobilePane === 'detail';
  const title = showingDetail
    ? currentSession?.title || 'Chat'
    : workspace?.name || 'Workspace';

  const handleNewThread = () => {
    createSession();
  };

  return (
    <header className="fixed top-0 start-0 end-0 z-50 flex items-center shrink-0 bg-background/95 backdrop-blur-sm border-b h-[var(--header-height-mobile)]">
      <div className="grow flex items-center justify-between gap-2 px-3">
        <div className="flex items-center gap-2 min-w-0">
          {showingDetail ? (
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              className="shrink-0"
              onClick={openMobileList}
              aria-label="Back to chats"
            >
              <ChevronLeft className="size-5" />
            </Button>
          ) : (
            <div className="size-7 shrink-0 ml-1">
              <Image
                src="/logo-black.png"
                alt="OpenAgents"
                width={28}
                height={28}
                className="size-full object-contain dark:hidden"
              />
              <Image
                src="/logo-white.png"
                alt="OpenAgents"
                width={28}
                height={28}
                className="size-full object-contain hidden dark:block"
              />
            </div>
          )}
          <span className="text-sm font-medium truncate">{title}</span>
        </div>

        {!showingDetail && (
          <button
            onClick={handleNewThread}
            className="size-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0"
            title="New chat"
            aria-label="New chat"
          >
            <SquarePen className="size-4" />
          </button>
        )}
      </div>
    </header>
  );
}
