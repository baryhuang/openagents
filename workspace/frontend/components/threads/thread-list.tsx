'use client';

import { useState } from 'react';
import { PanelLeft, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { getAgentColor, getAgentInitials, timeAgo } from '@/lib/helpers';
import type { WorkspaceAgent } from '@/lib/types';

function AvatarStack({ agents, max = 3 }: { agents: WorkspaceAgent[]; max?: number }) {
  const shown = agents.slice(0, max);
  const extra = agents.length - max;
  const agentNames = agents.map((a) => a.agentName);

  return (
    <div className="flex -space-x-1.5">
      {shown.map((agent) => {
        const color = getAgentColor(agent.agentName, agentNames);
        return (
          <div
            key={agent.agentName}
            className={cn(
              'size-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold border-2 border-white',
              color.initials
            )}
          >
            {getAgentInitials(agent.agentName)}
          </div>
        );
      })}
      {extra > 0 && (
        <div className="size-5 rounded-full bg-zinc-200 flex items-center justify-center text-[8px] font-medium text-zinc-600 border-2 border-white">
          +{extra}
        </div>
      )}
    </div>
  );
}

export function ThreadList() {
  const { sessions, currentSessionId, setCurrentSessionId, agents, lastMessageBySession, activeSessionIds } = useWorkspace();
  const { sidebarToggle } = useLayout();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSessions = searchQuery
    ? sessions.filter((s) => s.title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-3 shrink-0">
        <button
          onClick={sidebarToggle}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-muted-foreground transition-colors shrink-0"
        >
          <PanelLeft className="size-4" />
        </button>
        <div className="flex items-center w-full gap-1">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-input text-muted-foreground">
            <Search className="size-3.5" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
            />
          </div>
          <button
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-muted-foreground transition-colors shrink-0"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Thread rows */}
      <div className="flex-1 overflow-y-auto px-4 py-1">
        <div className="space-y-1">
          {filteredSessions.map((session) => {
            const isSelected = session.sessionId === currentSessionId;
            const lastMsg = lastMessageBySession[session.sessionId];
            const isActive = activeSessionIds.has(session.sessionId);

            return (
              <button
                key={session.sessionId}
                onClick={() => setCurrentSessionId(session.sessionId)}
                className={cn(
                  'w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors relative group',
                  isSelected ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                )}
              >
                {/* Avatar stack */}
                <div className="shrink-0 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 rounded-full size-[30px] bg-white dark:bg-zinc-900">
                  <AvatarStack agents={agents} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm flex-1 min-w-0 truncate font-normal text-foreground">
                      {session.title || 'Untitled'}
                    </span>
                    {isActive && (
                      <span className="relative flex size-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground shrink-0">
                      {session.createdAt ? timeAgo(session.createdAt) : ''}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {lastMsg
                      ? `${lastMsg.senderName === 'user' ? 'You' : lastMsg.senderName}: ${lastMsg.content}`
                      : 'No messages yet'}
                  </p>
                </div>
              </button>
            );
          })}

          {filteredSessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">No threads yet</p>
              <p className="text-xs mt-1">Create a thread to start chatting</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
