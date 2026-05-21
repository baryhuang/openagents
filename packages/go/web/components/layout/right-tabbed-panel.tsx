'use client';

/**
 * Tabbed right-side panel sitting next to the chat detail when the user
 * is in `viewMode === 'threads'`. Mirrors the Swift `ContentSidebar`'s
 * `[Content | Browser]` header tabs introduced in 0.3.0.
 *
 *   - Content tab: workspace files (FileList + FilePreview)
 *   - Browser tab: live Browser Fabric session (BrowserView). The tab is
 *     hidden unless `workspace.browserEnabled === true` — mirrors
 *     `WorkspaceStore.browserPanelAvailable` on Swift.
 *
 * Auto-rebound: if the user is parked on the Browser tab and the
 * workspace toggle gets flipped off, we bounce to Content.
 */

import { useEffect } from 'react';
import { FileText, Globe, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayout } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { FileList } from '@/components/files/file-list';
import { FilePreview } from '@/components/files/file-preview';
import { BrowserView } from '@/components/browser/browser-view';

export function RightTabbedPanel() {
  const { rightPanelOpen, setRightPanelOpen, rightPanelTab, setRightPanelTab } = useLayout();
  const { workspace, selectedFileId } = useWorkspace();

  const browserAvailable = !!workspace?.browserEnabled;

  // If user is viewing Browser when the workspace toggle flips off,
  // bounce them to Content.
  useEffect(() => {
    if (!browserAvailable && rightPanelTab === 'browser') {
      setRightPanelTab('content');
    }
  }, [browserAvailable, rightPanelTab, setRightPanelTab]);

  if (!rightPanelOpen) return null;

  return (
    <aside className="shrink-0 w-[280px] xl:w-[360px] bg-background border border-input rounded-xl shadow-xs overflow-hidden flex flex-col">
      {/* Tab header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-input shrink-0">
        <TabButton active={rightPanelTab === 'content'} onClick={() => setRightPanelTab('content')}>
          <FileText className="size-3.5" />
          <span>Content</span>
        </TabButton>
        {browserAvailable && (
          <TabButton active={rightPanelTab === 'browser'} onClick={() => setRightPanelTab('browser')}>
            <Globe className="size-3.5" />
            <span>Browser</span>
          </TabButton>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setRightPanelOpen(false)}
          className="size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="Close panel"
          aria-label="Close right panel"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {rightPanelTab === 'content' ? (
          selectedFileId ? <FilePreview /> : <FileList />
        ) : (
          <BrowserView />
        )}
      </div>
    </aside>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800',
      )}
    >
      {children}
    </button>
  );
}
