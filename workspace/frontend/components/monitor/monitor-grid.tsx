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

          // Find last user message
          const lastUser = msgs.find((m) => m.senderType !== 'agent') || null;

          // Find last agent chat message (not status/thinking)
          const lastAgentChat = msgs.find(
            (m) => m.senderType === 'agent' && m.messageType !== 'status' && m.messageType !== 'thinking'
          ) || null;

          // Find last agent status/thinking
          const lastAgentStatus = msgs.find(
            (m) => m.senderType === 'agent' && (m.messageType === 'status' || m.messageType === 'thinking')
          ) || null;

          // If the latest agent message is status/thinking, agent is working — show that
          // Otherwise show the final chat response
          const latestAgentAny = msgs.find((m) => m.senderType === 'agent');
          const agentIsWorking = latestAgentAny && (latestAgentAny.messageType === 'status' || latestAgentAny.messageType === 'thinking');

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
            lastAgentMessage: agentIsWorking ? lastAgentStatus : lastAgentChat,
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

  return (
    <>
      <div className="grid grid-cols-3 grid-rows-2 gap-2.5 h-full">
        {topSessions.map((session) => (
          <MonitorTile
            key={session.sessionId}
            session={session}
            tileData={tileData[session.sessionId]}
            isActive={activeSessionIds.has(session.sessionId)}
            isCompleted={completedSessionIds.has(session.sessionId)}
            agents={agents}
            onClick={() => handleTileClick(session.sessionId)}
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
