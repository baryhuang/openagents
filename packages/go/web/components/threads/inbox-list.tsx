'use client';

// Flat reverse-chronological feed of routine channels. Sessions whose
// `sessionId` starts with `routines:` are system-managed inboxes — each
// agent gets its own. Unlike the Chats list, the Inbox doesn't group
// by agent: it's an email-style stream of "what your agents have done
// for you lately." Unread state lives client-side in localStorage and
// flips to read when the row is opened.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Wrench, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { timeAgo, isRoutineChannel, routineAgentName } from '@/lib/helpers';
import { AgentAvatar } from '@/components/agents/agent-avatar';

function readMap(workspaceId: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(`inbox-read:${workspaceId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeMap(workspaceId: string, map: Record<string, number>): void {
  try {
    localStorage.setItem(`inbox-read:${workspaceId}`, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable (private mode, quota); ignore.
  }
}

export function InboxList() {
  const {
    workspace,
    sessions,
    currentSessionId,
    setCurrentSessionId,
    lastMessageBySession,
    activeSessionIds,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();

  const workspaceId = workspace?.workspaceId ?? '';
  const [readMapState, setReadMapState] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!workspaceId) return;
    setReadMapState(readMap(workspaceId));
  }, [workspaceId]);

  // Mark a session as read up to its current lastEventAt.
  const markRead = useCallback(
    (sessionId: string, ts: number | null) => {
      if (!workspaceId || !ts) return;
      setReadMapState((prev) => {
        if ((prev[sessionId] ?? 0) >= ts) return prev;
        const next = { ...prev, [sessionId]: ts };
        writeMap(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  // When the user navigates into a routine session via any path
  // (keyboard, mobile, sidebar), mark it read.
  useEffect(() => {
    if (!currentSessionId) return;
    if (!isRoutineChannel(currentSessionId)) return;
    const session = sessions.find((s) => s.sessionId === currentSessionId);
    if (!session) return;
    markRead(currentSessionId, session.lastEventAt);
  }, [currentSessionId, sessions, markRead]);

  const routineSessions = useMemo(
    () =>
      sessions
        .filter((s) => isRoutineChannel(s.sessionId) && s.status !== 'deleted')
        .sort((a, b) => (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0)),
    [sessions],
  );

  if (routineSessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <CalendarClock className="size-6 mb-2 opacity-50" />
        <p className="text-sm">Inbox is empty</p>
        <p className="text-xs mt-1">Routine activity from your agents will appear here</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-1">
      <div className="space-y-1">
        {routineSessions.map((session) => {
          const agentName = routineAgentName(session.sessionId) ?? session.title;
          const lastMsg = lastMessageBySession[session.sessionId];
          const isSelected = session.sessionId === currentSessionId;
          const isActive = activeSessionIds.has(session.sessionId);
          const lastReadAt = readMapState[session.sessionId] ?? 0;
          const isUnread =
            !!session.lastEventAt && session.lastEventAt > lastReadAt;

          const displayTime = session.lastEventAt
            ? timeAgo(new Date(session.lastEventAt).toISOString())
            : '';

          // Preview: same logic as ThreadList but tightened (single line).
          let preview: React.ReactNode = 'No activity yet';
          let previewIsStatus = false;
          if (lastMsg && lastMsg.content) {
            const sender = lastMsg.senderName === 'user' ? 'You' : lastMsg.senderName;
            if (lastMsg.isStatus) {
              previewIsStatus = true;
              const toolMatch = lastMsg.content.match(/Using tool:?\**\s*`?([^`\n]+)`?/i);
              if (toolMatch) {
                const cleanTool = toolMatch[1].trim().replace(/^mcp__[^_]+__/, '');
                preview = (
                  <span className="flex items-center gap-1">
                    {sender}: <Wrench className="size-3 shrink-0" /> {cleanTool}
                  </span>
                );
              } else if (lastMsg.content.includes('thinking')) {
                preview = (
                  <span className="flex items-center gap-1">
                    {sender}: <Loader2 className="size-3 shrink-0 animate-spin" /> thinking...
                  </span>
                );
              } else {
                const cleaned = lastMsg.content
                  .replace(/\*\*/g, '')
                  .replace(/`/g, '')
                  .replace(/```[\s\S]*/g, '')
                  .trim();
                preview = `${sender}: ${cleaned}`;
              }
            } else {
              preview = `${sender}: ${lastMsg.content}`;
            }
          }

          return (
            <div
              key={session.sessionId}
              onClick={() => {
                setCurrentSessionId(session.sessionId);
                if (isMobile) openMobileDetail();
              }}
              className={cn(
                'w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors cursor-pointer',
                isSelected
                  ? 'bg-zinc-100 dark:bg-zinc-800 ring-2 ring-indigo-500 dark:ring-indigo-400'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
              )}
            >
              {/* Unread dot column — fixed width so rows align whether
                  unread or not. */}
              <div className="shrink-0 w-2 flex items-center justify-center">
                {isUnread && (
                  <span className="size-2 rounded-full bg-indigo-500" aria-label="Unread" />
                )}
              </div>

              <div className="shrink-0">
                <AgentAvatar name={agentName} size={30} />
              </div>

              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'text-sm flex-1 min-w-0 truncate text-foreground',
                      isUnread ? 'font-semibold' : 'font-normal',
                    )}
                  >
                    {agentName}
                  </span>
                  {isActive && (
                    <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">
                    {displayTime}
                  </span>
                </div>
                <p
                  className={cn(
                    'text-xs text-muted-foreground truncate',
                    previewIsStatus && 'italic',
                  )}
                >
                  {preview}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Number of routine sessions with new activity since their last read.
 *  Exposed for the tab badge in the sidebar. */
export function useInboxUnreadCount(): number {
  const { workspace, sessions } = useWorkspace();
  const workspaceId = workspace?.workspaceId ?? '';
  const [readMapState, setReadMapState] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!workspaceId) return;
    setReadMapState(readMap(workspaceId));
    // Re-read on storage events so two tabs stay roughly in sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key === `inbox-read:${workspaceId}`) {
        setReadMapState(readMap(workspaceId));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [workspaceId]);

  // Also poll the map every few seconds while mounted — covers the case
  // where InboxList writes to localStorage in the same tab (no storage
  // event fires for same-window writes).
  useEffect(() => {
    if (!workspaceId) return;
    const id = setInterval(() => setReadMapState(readMap(workspaceId)), 2000);
    return () => clearInterval(id);
  }, [workspaceId]);

  return useMemo(
    () =>
      sessions.filter(
        (s) =>
          isRoutineChannel(s.sessionId) &&
          s.status !== 'deleted' &&
          !!s.lastEventAt &&
          s.lastEventAt > (readMapState[s.sessionId] ?? 0),
      ).length,
    [sessions, readMapState],
  );
}
