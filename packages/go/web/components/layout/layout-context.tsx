'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { TooltipProvider } from '@/components/ui/tooltip';

// `viewMode` used to drive a permanent left nav rail (Chats / Files /
// Tasks / Routines / Browser / Connect). The 2-pane Swift mirror killed
// that rail; the only "mode" left is whether we're showing the chat
// detail (always) plus the right inspector tabs (Content / Browser).
// We keep the type+setter as a back-compat shim so a few legacy callers
// (file chip clicks, etc.) don't break — they now redirect to the right
// inspector.
export type ViewMode = 'threads' | 'files' | 'browser';

/** On mobile, which pane is showing: the list or the detail */
export type MobilePane = 'list' | 'detail';

interface LayoutState {
  isMobile: boolean;
  isSidebarOpen: boolean;
  sidebarToggle: () => void;
  /** Legacy — always 'threads' now. Setter routes 'files' / 'browser' to
   *  the right inspector instead of swapping the main column. */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedAgentName: string | null;
  setSelectedAgentName: (name: string | null) => void;
  isAgentPanelOpen: boolean;
  /** Which pane is visible on mobile (ignored on desktop) */
  mobilePane: MobilePane;
  openMobileDetail: () => void;
  openMobileList: () => void;
  /** Whether the detail pane is expanded to full width (hides sidebar). */
  isDetailExpanded: boolean;
  toggleDetailExpanded: () => void;
  /** Experimental: show browser tab side-by-side with chat. */
  splitBrowser: boolean;
  setSplitBrowser: (v: boolean) => void;
  showBrowserPreview: boolean;
  setShowBrowserPreview: (v: boolean) => void;
  /**
   * Right-side tabbed panel (Content | Browser) shown alongside the chat
   * detail. Mirrors Swift's `ContentSidebar` w/ tab bar.
   */
  rightPanelOpen: boolean;
  setRightPanelOpen: (v: boolean) => void;
  rightPanelTab: 'content' | 'browser';
  setRightPanelTab: (t: 'content' | 'browser') => void;
  /** User-resizable right-panel width in px. Persists to localStorage.
   *  Mirrors Swift's `sidebarWidth` + drag handle in ChatView. */
  rightPanelWidth: number;
  setRightPanelWidth: (px: number) => void;
}

const LayoutContext = createContext<LayoutState | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('list');
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);
  const [splitBrowser, setSplitBrowserState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('x-split-browser') === '1';
  });

  const setSplitBrowser = useCallback((v: boolean) => {
    setSplitBrowserState(v);
    if (typeof window !== 'undefined') {
      localStorage.setItem('x-split-browser', v ? '1' : '0');
    }
  }, []);

  const [showBrowserPreview, setShowBrowserPreview] = useState(false);

  const [rightPanelOpen, setRightPanelOpenState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('x-right-panel-open') === '1';
  });
  const setRightPanelOpen = useCallback((v: boolean) => {
    setRightPanelOpenState(v);
    if (typeof window !== 'undefined') {
      localStorage.setItem('x-right-panel-open', v ? '1' : '0');
    }
  }, []);
  const [rightPanelTab, setRightPanelTab] = useState<'content' | 'browser'>('content');
  const [rightPanelWidth, setRightPanelWidthState] = useState<number>(() => {
    if (typeof window === 'undefined') return 320;
    const stored = parseInt(localStorage.getItem('x-right-panel-width') || '', 10);
    return Number.isFinite(stored) && stored >= 240 ? stored : 320;
  });
  const setRightPanelWidth = useCallback((px: number) => {
    setRightPanelWidthState(px);
    if (typeof window !== 'undefined') {
      localStorage.setItem('x-right-panel-width', String(Math.round(px)));
    }
  }, []);

  // Legacy viewMode shim: 'files' → open right inspector to Content tab,
  // 'browser' → open right inspector to Browser tab. 'threads' is a no-op.
  const viewMode: ViewMode = 'threads';
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (mode === 'files') {
        setRightPanelOpen(true);
        setRightPanelTab('content');
        if (isMobile) setMobilePane('detail');
      } else if (mode === 'browser') {
        setRightPanelOpen(true);
        setRightPanelTab('browser');
        if (isMobile) setMobilePane('detail');
      }
      // 'threads' → no-op (we're always in threads mode)
    },
    [isMobile, setRightPanelOpen],
  );

  const isAgentPanelOpen = selectedAgentName !== null;
  const openMobileDetail = () => setMobilePane('detail');
  const openMobileList = () => setMobilePane('list');
  const toggleDetailExpanded = () => setIsDetailExpanded((v) => !v);

  const cssVariables = useMemo(
    () =>
      ({
        '--sidebar-width': '300px',
        '--sidebar-width-collapsed': '52px',
        '--header-height-mobile': '60px',
      }) as React.CSSProperties,
    [],
  );

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
    <LayoutContext.Provider
      value={{
        isMobile,
        isSidebarOpen,
        sidebarToggle,
        viewMode,
        setViewMode,
        selectedAgentName,
        setSelectedAgentName,
        isAgentPanelOpen,
        mobilePane,
        openMobileDetail,
        openMobileList,
        isDetailExpanded,
        toggleDetailExpanded,
        splitBrowser,
        setSplitBrowser,
        showBrowserPreview,
        setShowBrowserPreview,
        rightPanelOpen,
        setRightPanelOpen,
        rightPanelTab,
        setRightPanelTab,
        rightPanelWidth,
        setRightPanelWidth,
      }}
    >
      <div data-slot="layout-wrapper" className="flex grow">
        <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
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
