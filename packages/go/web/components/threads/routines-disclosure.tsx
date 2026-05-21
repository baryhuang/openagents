'use client';

// Mirrors Swift's `DisclosureGroup` for routine channels at the bottom
// of `ThreadListView`. Routine channels follow the convention used by
// the Swift app: their `sessionId` starts with `routines:` and the bit
// after the prefix is the agent name. They're segregated from regular
// chats because their lifecycle is system-managed (each agent gets one
// routine channel per workspace and every routine fires into it).

import { useState } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { timeAgo } from '@/lib/helpers';

const ROUTINE_PREFIX = 'routines:';

export function RoutinesDisclosure() {
  const {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    lastMessageBySession,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const [expanded, setExpanded] = useState(false);

  const routineSessions = sessions.filter((s) =>
    s.sessionId.startsWith(ROUTINE_PREFIX),
  );
  if (routineSessions.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <CalendarClock className="size-3" />
        <span>Routines ({routineSessions.length})</span>
        <ChevronDown
          className={cn(
            'size-3 ml-auto transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {routineSessions.map((session) => {
            const agentName =
              session.sessionId.slice(ROUTINE_PREFIX.length) || session.title;
            const lastMsg = lastMessageBySession[session.sessionId];
            const isSelected = session.sessionId === currentSessionId;

            const displayTime = session.lastEventAt
              ? timeAgo(new Date(session.lastEventAt).toISOString())
              : '';

            const preview =
              lastMsg && lastMsg.content
                ? `${lastMsg.senderName === 'user' ? 'You' : lastMsg.senderName}: ${lastMsg.content}`
                : '';

            return (
              <div
                key={session.sessionId}
                onClick={() => {
                  setCurrentSessionId(session.sessionId);
                  if (isMobile) openMobileDetail();
                }}
                className={cn(
                  'w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-colors cursor-pointer',
                  isSelected
                    ? 'bg-zinc-100 dark:bg-zinc-800 ring-2 ring-indigo-500 dark:ring-indigo-400'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                )}
              >
                <div className="shrink-0 size-[30px] rounded-full bg-muted/60 flex items-center justify-center">
                  <CalendarClock className="size-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm flex-1 min-w-0 truncate font-normal text-foreground">
                      {agentName}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {displayTime}
                    </span>
                  </div>
                  {preview && (
                    <p className="text-xs text-muted-foreground truncate">
                      {preview}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
