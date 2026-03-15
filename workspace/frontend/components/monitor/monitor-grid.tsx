'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { eventToMessage } from '@/lib/types';
import type { WorkspaceMessage } from '@/lib/types';
import { MonitorTile } from './monitor-tile';
import { MonitorOverlay } from './monitor-overlay';

const TILE_COUNT = 6;
const POLL_INTERVAL = 5_000;

export interface TileData {
  lastUserMessage: WorkspaceMessage | null;
  lastAgentMessage: WorkspaceMessage | null;
  /** Recent thinking/status steps when agent is actively working (newest first) */
  recentSteps: WorkspaceMessage[];
}

export function MonitorGrid() {
  const { sessions, activeSessionIds, completedSessionIds, agents, acknowledgeCompletion } = useWorkspace();
  const [overlaySessionId, setOverlaySessionId] = useState<string | null>(null);
  const [tileData, setTileData] = useState<Record<string, TileData>>({});
  // Message cache for instant overlay loading — stores all fetched messages per session (chronological)
  const messageCacheRef = React.useRef<Record<string, WorkspaceMessage[]>>({});

  // Top 6 most recent active sessions
  const topSessions = useMemo(() => {
    return [...sessions]
      .filter((s) => s.status === 'active')
      .sort((a, b) => {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        const aTime = a.lastEventAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const bTime = b.lastEventAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return bTime - aTime;
      })
      .slice(0, TILE_COUNT);
  }, [sessions]);

  // Fetch last turn data for all visible tiles
  const fetchTileData = useCallback(async () => {
    const results: Record<string, TileData> = {};
    await Promise.all(
      topSessions.map(async (session) => {
        try {
          const result = await workspaceApi.pollEvents({
            channel: session.sessionId,
            type: 'workspace.message',
            sort: 'desc',
            limit: 50,
          });
          const msgs = result.events.map(eventToMessage);

          // Find indices of key messages (msgs sorted newest-first)
          const lastUserIdx = msgs.findIndex((m) => m.senderType !== 'agent');
          const lastUser = lastUserIdx >= 0 ? msgs[lastUserIdx] : null;

          // Find last agent chat message (not status/thinking)
          const lastAgentChatIdx = msgs.findIndex(
            (m) => m.senderType === 'agent' && m.messageType !== 'status' && m.messageType !== 'thinking'
          );
          const lastAgentChat = lastAgentChatIdx >= 0 ? msgs[lastAgentChatIdx] : null;

          // Find last agent status/thinking
          const lastAgentStatus = msgs.find(
            (m) => m.senderType === 'agent' && (m.messageType === 'status' || m.messageType === 'thinking')
          ) || null;

          // If the latest agent message is status/thinking, agent is working — show that
          // Otherwise show the final chat response
          const latestAgentAny = msgs.find((m) => m.senderType === 'agent');
          const agentIsWorking = latestAgentAny && (latestAgentAny.messageType === 'status' || latestAgentAny.messageType === 'thinking');

          // Only show agent chat response if it's newer than the last user message
          // (lower index = newer in desc-sorted array). If user message is newer,
          // the old agent response is stale and shouldn't be shown.
          const agentChatIsStale = lastAgentChat && lastUser && lastAgentChatIdx > lastUserIdx;

          // Collect recent thinking/status steps (newest first, deduplicated)
          const recentSteps: WorkspaceMessage[] = [];
          if (agentIsWorking) {
            const seen = new Set<string>();
            for (const m of msgs) {
              if (m.senderType !== 'agent') break; // stop at first non-agent msg
              if (m.messageType === 'status' || m.messageType === 'thinking') {
                // Deduplicate by content (status can repeat)
                const key = m.content.slice(0, 100);
                if (!seen.has(key) && m.content.trim()) {
                  seen.add(key);
                  recentSteps.push(m);
                }
              }
            }
          }

          results[session.sessionId] = {
            lastUserMessage: lastUser,
            lastAgentMessage: agentIsWorking ? lastAgentStatus : (agentChatIsStale ? null : lastAgentChat),
            recentSteps,
          };

          // Cache messages in chronological order for instant overlay loading
          messageCacheRef.current[session.sessionId] = [...msgs].reverse();
        } catch {
          // Keep existing data on error
        }
      })
    );
    setTileData((prev) => ({ ...prev, ...results }));
  }, [topSessions]);

  // Initial fetch + polling
  useEffect(() => {
    if (topSessions.length === 0) return;
    fetchTileData();
    const interval = setInterval(fetchTileData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchTileData, topSessions.length]);

  const overlaySession = sessions.find((s) => s.sessionId === overlaySessionId);

  const handleTileClick = (sessionId: string) => {
    acknowledgeCompletion(sessionId);
    setOverlaySessionId(sessionId);
  };

  // Keyboard shortcuts: 1-6 opens corresponding tile overlay
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea or when overlay is open
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (overlaySessionId) return;

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 6) {
        const idx = num - 1;
        const session = topSessions[idx];
        if (session) {
          e.preventDefault();
          handleTileClick(session.sessionId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [topSessions, overlaySessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="grid grid-cols-3 grid-rows-2 gap-2.5 h-full">
        {topSessions.map((session, idx) => (
          <MonitorTile
            key={session.sessionId}
            session={session}
            tileData={tileData[session.sessionId]}
            isActive={activeSessionIds.has(session.sessionId)}
            isCompleted={completedSessionIds.has(session.sessionId)}
            agents={agents}
            onClick={() => handleTileClick(session.sessionId)}
            shortcutKey={idx + 1}
          />
        ))}
        {Array.from({ length: Math.max(0, TILE_COUNT - topSessions.length) }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="border border-dashed border-input rounded-xl flex items-center justify-center text-muted-foreground/40 text-xs"
          >
            No thread
          </div>
        ))}
      </div>

      {overlaySessionId && overlaySession && (
        <MonitorOverlay
          sessionId={overlaySessionId}
          session={overlaySession}
          initialMessages={messageCacheRef.current[overlaySessionId]}
          open
          onOpenChange={(open) => { if (!open) setOverlaySessionId(null); }}
        />
      )}
    </>
  );
}
