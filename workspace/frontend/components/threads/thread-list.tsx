'use client';

import { useState, useEffect, useRef } from 'react';
import { PanelLeft, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { getAgentColor, getAgentInitials, timeAgo } from '@/lib/helpers';
import { workspaceApi } from '@/lib/api';
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

interface SearchHit {
  channelName: string;
  snippet: string;
  messageId: string;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function ThreadList() {
  const { sessions, currentSessionId, setCurrentSessionId, agents, lastMessageBySession, activeSessionIds } = useWorkspace();
  const { sidebarToggle } = useLayout();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced content search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await workspaceApi.searchMessages(searchQuery.trim());
        setSearchResults(hits);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // When searching, show sessions that match by title OR have content hits
  const isSearching = searchQuery.trim().length > 0;
  const hitsByChannel = new Map<string, SearchHit>();
  for (const hit of searchResults) {
    if (!hitsByChannel.has(hit.channelName)) {
      hitsByChannel.set(hit.channelName, hit);
    }
  }

  // Sort sessions by most recent activity: in-session update > backend last_event_at > createdAt
  const sortedSessions = [...sessions].sort((a, b) => {
    const aTime = lastMessageBySession[a.sessionId]?.timestamp
      || a.lastEventAt
      || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    const bTime = lastMessageBySession[b.sessionId]?.timestamp
      || b.lastEventAt
      || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    return bTime - aTime;
  });

  const filteredSessions = isSearching
    ? sortedSessions.filter((s) =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        hitsByChannel.has(s.sessionId)
      )
    : sortedSessions;

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
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
            />
            {searching && (
              <div className="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            )}
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
            const contentHit = hitsByChannel.get(session.sessionId);

            // Show last activity time: in-session > backend last_event_at > createdAt
            const activityMs = lastMsg?.timestamp || session.lastEventAt;
            const displayTime = activityMs
              ? timeAgo(new Date(activityMs).toISOString())
              : session.createdAt ? timeAgo(session.createdAt) : '';

            // Determine the preview line
            let preview: React.ReactNode;
            if (isSearching && contentHit) {
              // Show matching snippet with highlight
              const snippet = contentHit.snippet.length > 80
                ? contentHit.snippet.slice(0, 80) + '...'
                : contentHit.snippet;
              preview = highlightMatch(snippet, searchQuery);
            } else if (lastMsg && lastMsg.content) {
              preview = `${lastMsg.senderName === 'user' ? 'You' : lastMsg.senderName}: ${lastMsg.content}`;
            } else {
              preview = 'No messages yet';
            }

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
                      {isSearching
                        ? highlightMatch(session.title || 'Untitled', searchQuery)
                        : (session.title || 'Untitled')}
                    </span>
                    {isActive && (
                      <span className="relative flex size-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground shrink-0">
                      {displayTime}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {preview}
                  </p>
                </div>
              </button>
            );
          })}

          {filteredSessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              {isSearching ? (
                <>
                  <p className="text-sm">No results found</p>
                  <p className="text-xs mt-1">Try a different search term</p>
                </>
              ) : (
                <>
                  <p className="text-sm">No threads yet</p>
                  <p className="text-xs mt-1">Create a thread to start chatting</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
