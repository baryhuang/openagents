'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { PanelLeft, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLayout } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';

export function SidebarHeader() {
  const { sidebarToggle, isSidebarOpen } = useLayout();
  const { workspace, renameWorkspace, setBrowserEnabled } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Workspace-scoped Browser Fabric viewer toggle — mirrors the Safari
  // button in the Swift app's workspace header. Filled-blue when ON,
  // muted globe when OFF. Persists via PATCH /v1/workspaces/{id}.
  const browserEnabled = !!workspace?.browserEnabled;
  const toggleBrowser = () => {
    if (!workspace) return;
    setBrowserEnabled(!browserEnabled).catch(() => {
      // toast.error already fired inside the context callback
    });
  };

  const startEditing = () => {
    setDraft(workspace?.name || '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== workspace?.name) {
      renameWorkspace(trimmed);
    }
  };

  if (!isSidebarOpen) {
    return (
      <div className="flex items-center justify-center shrink-0 px-2.5 py-3.5">
        <Button mode="icon" variant="ghost" onClick={sidebarToggle} className="hidden lg:inline-flex shrink-0" title="Toggle sidebar">
          <PanelLeft />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 shrink-0 px-3.5 py-4">
      <div className="size-8 shrink-0">
        <Image src="/logo-black.png" alt="OpenAgents" width={32} height={32} className="size-full object-contain dark:hidden" />
        <Image src="/logo-white.png" alt="OpenAgents" width={32} height={32} className="size-full object-contain hidden dark:block" />
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="text-sm font-medium bg-transparent border-b border-primary outline-none w-full min-w-0"
            autoFocus
          />
        ) : (
          <p
            className="text-sm font-medium truncate cursor-pointer hover:text-primary transition-colors"
            onClick={startEditing}
            title="Click to rename"
          >
            {workspace?.name || 'Workspace'}
          </p>
        )}
        <p className="text-xs text-muted-foreground truncate font-mono">{workspace?.slug || ''}</p>
      </div>
      <button
        onClick={toggleBrowser}
        disabled={!workspace}
        className={cn(
          'size-7 flex items-center justify-center rounded-md transition-colors shrink-0',
          browserEnabled
            ? 'bg-primary/10 text-primary hover:bg-primary/15'
            : 'text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800',
        )}
        title={browserEnabled ? 'Hide browser panel for this workspace' : 'Show browser panel when a session is live'}
        aria-label={browserEnabled ? 'Disable browser panel' : 'Enable browser panel'}
      >
        <Globe className="size-4" />
      </button>
    </div>
  );
}
