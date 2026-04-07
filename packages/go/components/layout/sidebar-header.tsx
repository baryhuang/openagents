'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { PanelLeft, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLayout } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';

export function SidebarHeader() {
  const router = useRouter();
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            mode="icon"
            variant="ghost"
            className="shrink-0 size-7"
            onClick={async () => {
              // Update workspace name in history before switching
              if (window.electronAPI && workspace) {
                const settings = await window.electronAPI.settings.load();
                if (settings.workspaceId) {
                  await window.electronAPI.settings.save({
                    ...settings,
                    workspaceName: workspace.name || settings.workspaceId,
                  });
                }
              }
              router.push('/?switch=1');
            }}
          >
            <ArrowLeftRight className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Switch Workspace</TooltipContent>
      </Tooltip>
    </div>
  );
}
