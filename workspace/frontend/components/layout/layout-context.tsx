'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { TooltipProvider } from '@/components/ui/tooltip';

export type ViewMode = 'threads' | 'files' | 'browser' | 'connect';

interface LayoutState {
  isMobile: boolean;
  isSidebarOpen: boolean;
  sidebarToggle: () => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedAgentName: string | null;
  setSelectedAgentName: (name: string | null) => void;
  isAgentPanelOpen: boolean;
}

const LayoutContext = createContext<LayoutState | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('threads');
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);

  const isAgentPanelOpen = selectedAgentName !== null;

  const cssVariables = useMemo(() => ({
    '--sidebar-width': '240px',
    '--sidebar-width-collapsed': '52px',
    '--header-height-mobile': '60px',
  } as React.CSSProperties), []);

  const sidebarToggle = () => setIsSidebarOpen((open) => !open);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    Object.entries(cssVariables).forEach(([prop, val]) => {
      html.style.setProperty(prop, val as string);
    });

    body.setAttribute('data-sidebar-open', isSidebarOpen.toString());

    return () => {
      Object.keys(cssVariables).forEach((prop) => {
        html.style.removeProperty(prop);
      });
      body.removeAttribute('data-sidebar-open');
    };
  }, [cssVariables, isSidebarOpen]);

  return (
    <LayoutContext.Provider value={{
      isMobile,
      isSidebarOpen,
      sidebarToggle,
      viewMode,
      setViewMode,
      selectedAgentName,
      setSelectedAgentName,
      isAgentPanelOpen,
    }}>
      <div data-slot="layout-wrapper" className="flex grow">
        <TooltipProvider delayDuration={0}>
          {children}
        </TooltipProvider>
      </div>
    </LayoutContext.Provider>
  );
}

export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
};
