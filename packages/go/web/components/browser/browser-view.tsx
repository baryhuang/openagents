'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, RefreshCw, ChevronLeft, Maximize2, X } from 'lucide-react';
import { toast } from 'sonner';

// Middle-truncate a long URL the way Swift's `.truncationMode(.middle)`
// does — preserve the beginning (scheme + host) and the end (last path
// segment + query) so users can still tell at a glance where they are.
function middleTruncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const keep = Math.max(8, Math.floor((maxLen - 1) / 2));
  return s.slice(0, keep) + '…' + s.slice(-keep);
}
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';

export function BrowserView() {
  const {
    browserTabs, selectedBrowserTabId, setSelectedBrowserTabId,
    reconnectBrowserTab,
    refreshBrowserTabs,
  } = useWorkspace();
  const { isMobile, openMobileList } = useLayout();
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [sessionDead, setSessionDead] = useState(false);
  const [navigating, setNavigating] = useState(false);
  // True app-front modal — covers everything (parity with Swift's
  // FullscreenBrowserSheet).
  const [presentMode, setPresentMode] = useState(false);
  const prevBlobRef = useRef<string | null>(null);
  const failCountRef = useRef(0);

  const tab = browserTabs.find((t) => t.id === selectedBrowserTabId);

  // Validate live session on mount / tab switch. The backend checks if the
  // BF session is still alive and auto-reconnects if dead, returning fresh
  // tab data (including a new live_url).
  useEffect(() => {
    if (!selectedBrowserTabId || !tab?.liveUrl) return;
    let cancelled = false;

    const validate = async () => {
      setReconnecting(true);
      try {
        await workspaceApi.validateBrowserTab(selectedBrowserTabId);
        if (!cancelled) await refreshBrowserTabs();
      } catch {
        if (!cancelled) setSessionDead(true);
      } finally {
        if (!cancelled) setReconnecting(false);
      }
    };

    validate();
    return () => { cancelled = true; };
  }, [selectedBrowserTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll screenshot every 2 seconds (only when no live URL)
  useEffect(() => {
    if (!selectedBrowserTabId || !tab || tab.liveUrl) {
      setScreenshotUrl(null);
      return;
    }

    let cancelled = false;
    failCountRef.current = 0;
    setSessionDead(false);

    const fetchScreenshot = async () => {
      try {
        const url = workspaceApi.getBrowserScreenshotUrl(selectedBrowserTabId);
        const headers: Record<string, string> = {};
        const token = (workspaceApi as unknown as { token: string }).token;
        if (token) headers['X-Workspace-Token'] = token;
        const bearerToken = (workspaceApi as unknown as { bearerToken: string }).bearerToken;
        if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

        const res = await fetch(url, { headers });
        if (cancelled) return;
        if (!res.ok) {
          failCountRef.current++;
          if (failCountRef.current >= 3) {
            setSessionDead(true);
            setLoading(false);
          }
          return;
        }

        const blob = await res.blob();
        if (cancelled) return;

        failCountRef.current = 0;
        setSessionDead(false);

        if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);

        const blobUrl = URL.createObjectURL(blob);
        prevBlobRef.current = blobUrl;
        setScreenshotUrl(blobUrl);
        setLoading(false);
      } catch {
        failCountRef.current++;
        if (failCountRef.current >= 3) {
          setSessionDead(true);
          setLoading(false);
        }
      }
    };

    setLoading(true);
    fetchScreenshot();
    const interval = setInterval(fetchScreenshot, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (prevBlobRef.current) {
        URL.revokeObjectURL(prevBlobRef.current);
        prevBlobRef.current = null;
      }
    };
  }, [selectedBrowserTabId, tab]);

  const handleReconnect = async () => {
    if (!tab || reconnecting) return;
    setReconnecting(true);
    try {
      await reconnectBrowserTab(tab.id);
      setSessionDead(false);
      failCountRef.current = 0;
      setLoading(true);
      toast.success('Tab reconnected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reconnect');
    } finally {
      setReconnecting(false);
    }
  };

  // No tab selected
  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <Globe className="size-12 mx-auto opacity-20" />
          <p className="text-sm font-medium">Select a browser tab</p>
          <p className="text-xs">Choose a tab from the list or open a new one</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — strict Swift BrowserPanel mirror: Globe + (Title +
          URL middle-truncated OR "opened by <agent>") + Reload +
          Fullscreen. Swift commits 2e8a4791 + 00fa44a1. No extras. */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-input shrink-0">
        {isMobile && (
          <button
            onClick={openMobileList}
            className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
        <Globe
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground',
            navigating && 'text-amber-500 animate-pulse',
          )}
        />
        <div className="flex-1 min-w-0 leading-tight">
          <p
            className="text-[12px] font-semibold truncate"
            title={tab.title || 'Browser'}
          >
            {tab.title || 'Browser'}
          </p>
          {tab.url ? (
            <p
              className="text-[10px] text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis"
              title={tab.url}
            >
              {middleTruncate(tab.url, 56)}
            </p>
          ) : tab.createdBy ? (
            <p className="text-[10px] text-muted-foreground truncate">
              opened by {tab.createdBy.replace(/^(openagents:|human:)/, '')}
            </p>
          ) : null}
        </div>

        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          className="size-[22px] flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 disabled:opacity-50"
          title="Reload session"
          aria-label="Reload browser session"
        >
          <RefreshCw className={cn('size-3.5', reconnecting && 'animate-spin')} />
        </button>

        {/* Fullscreen take-over — matches Swift's
            `arrow.up.left.and.arrow.down.right`. No rotation. */}
        <button
          onClick={() => setPresentMode(true)}
          disabled={!tab.liveUrl}
          className="size-[22px] flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 disabled:opacity-30"
          title="Fullscreen"
          aria-label="Open browser in fullscreen"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>

      {/* Browser view area — overflow-hidden on the X axis so a wide
          iframe (Browser Fabric's live viewer can size its inner UI
          past the panel width) doesn't push the workspace into a
          horizontal scroll. Vertical scroll stays available for the
          screenshot fallback. */}
      <div className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto bg-zinc-50 dark:bg-zinc-900 flex items-start justify-center">
        {tab.liveUrl && !reconnecting ? (
          <iframe
            src={tab.liveUrl}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title={`Live browser: ${tab.url}`}
          />
        ) : sessionDead ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-3">
              <Globe className="size-10 mx-auto opacity-20" />
              <p className="text-sm font-medium">Browser session expired</p>
              <p className="text-xs text-muted-foreground">The remote browser timed out. Click reconnect to start a new session.</p>
              <button
                onClick={handleReconnect}
                disabled={reconnecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={cn("size-3.5", reconnecting && "animate-spin")} />
                {reconnecting ? 'Reconnecting…' : 'Reconnect'}
              </button>
            </div>
          </div>
        ) : loading && !screenshotUrl ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <RefreshCw className="size-6 animate-spin" />
          </div>
        ) : screenshotUrl ? (
          <div className="p-4 w-full flex justify-center">
            <img
              src={screenshotUrl}
              alt={`Screenshot of ${tab.url}`}
              className="max-w-full border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">No screenshot available</p>
          </div>
        )}
      </div>

      {/* Fullscreen modal — covers everything including chat. Esc to dismiss. */}
      {presentMode && tab.liveUrl && (
        <FullscreenBrowserModal
          title={tab.title || 'Browser'}
          url={tab.url}
          liveUrl={tab.liveUrl}
          onClose={() => setPresentMode(false)}
        />
      )}
    </div>
  );
}

function FullscreenBrowserModal({ title, url, liveUrl, onClose }: { title: string; url?: string; liveUrl: string; onClose: () => void }) {
  // Esc dismisses — mirrors Swift `.keyboardShortcut(.cancelAction)` on
  // the close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <Globe className="size-4 text-blue-500" />
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="text-sm font-semibold truncate">{title}</p>
          {url && <p className="text-xs text-muted-foreground truncate font-mono">{url}</p>}
        </div>
        <button
          onClick={onClose}
          className="size-8 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Close (Esc)"
          aria-label="Close fullscreen"
        >
          <X className="size-4" />
        </button>
      </div>
      <iframe
        src={liveUrl}
        className="flex-1 w-full border-0"
        allow="clipboard-read; clipboard-write"
        title={`Live browser: ${url || liveUrl}`}
      />
    </div>
  );
}
