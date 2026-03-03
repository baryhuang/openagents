'use client';

import { SidebarContent } from './sidebar-content';
import { SidebarHeader } from './sidebar-header';
import { useLayout } from './layout-context';

export function Sidebar() {
  const { isSidebarOpen } = useLayout();

  return (
    <aside className="fixed overflow-hidden bg-background rounded-xl top-2.5 bottom-2.5 start-2.5 z-20 transition-all duration-300 flex items-stretch shrink-0 w-(--sidebar-width) in-data-[sidebar-open=false]:w-(--sidebar-width-collapsed) border border-input">
      <div
        className="grow shrink-0 transition-all duration-300 flex flex-col"
        style={{ width: isSidebarOpen ? 'var(--sidebar-width)' : 'var(--sidebar-width-collapsed)' }}
      >
        <SidebarHeader />
        <SidebarContent />
      </div>
    </aside>
  );
}
