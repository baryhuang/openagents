'use client';

import { PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLayout } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';

export function SidebarHeader() {
  const { sidebarToggle, isSidebarOpen } = useLayout();
  const { workspace } = useWorkspace();

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
        W
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{workspace?.name || 'Workspace'}</p>
        <p className="text-xs text-muted-foreground truncate">workspace.openagents.org</p>
      </div>
    </div>
  );
}
