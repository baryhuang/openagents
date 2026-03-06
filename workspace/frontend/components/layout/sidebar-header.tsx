'use client';

import { useState, useRef } from 'react';
import { PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLayout } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';

export function SidebarHeader() {
  const { sidebarToggle, isSidebarOpen } = useLayout();
  const { workspace, renameWorkspace } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className="size-8 rounded-full bg-zinc-800 dark:bg-zinc-200 flex items-center justify-center text-white dark:text-zinc-800 text-xs font-bold shrink-0">
        {(workspace?.name || 'W')[0].toUpperCase()}
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
        <p className="text-xs text-muted-foreground truncate">workspace.openagents.org</p>
      </div>
    </div>
  );
}
