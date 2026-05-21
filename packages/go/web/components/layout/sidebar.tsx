'use client';

import { SidebarContent } from './sidebar-content';
import { useLayout } from './layout-context';

// Single column on desktop = workspace header + search + thread list +
// routines disclosure + footer. Mirrors Swift's ThreadListView. On mobile
// this same content fills the screen as the list pane.
export function Sidebar() {
  const { isSidebarOpen, isMobile } = useLayout();

  if (isMobile) {
    return (
      <div className="flex grow shrink-0 flex-col bg-background h-full overflow-hidden">
        <SidebarContent />
      </div>
    );
  }

  return (
    <aside
      className="fixed overflow-hidden bg-zinc-100 dark:bg-zinc-900 top-0 bottom-0 start-0 z-20 transition-all duration-300 flex items-stretch shrink-0 w-(--sidebar-width) in-data-[sidebar-open=false]:w-(--sidebar-width-collapsed)"
    >
      <div
        className="grow shrink-0 transition-all duration-300 flex flex-col"
        style={{
          width: isSidebarOpen
            ? 'var(--sidebar-width)'
            : 'var(--sidebar-width-collapsed)',
        }}
      >
        <SidebarContent />
      </div>
    </aside>
  );
}
