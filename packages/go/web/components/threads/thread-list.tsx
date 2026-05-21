'use client';

import { useState, useEffect, useRef } from 'react';
import { Pencil, Star, Archive, Trash2, MoreVertical, ArchiveRestore, Wrench, Loader2 } from 'lucide-react';
import { RoutinesDisclosure } from './routines-disclosure';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { timeAgo } from '@/lib/helpers';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceAgent } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function AvatarStack({ agents, max = 2 }: { agents: WorkspaceAgent[]; max?: number }) {
  const shown = agents.slice(0, max);
  const extra = agents.length - max;

  if (shown.length <= 1) {
    const agent = shown[0];
    if (!agent) return null;
    return <AgentAvatar name={agent.agentName} size={30} />;
  }

  return (
    <div className="flex -space-x-1.5">
      {shown.map((agent) => (
        <div key={agent.agentName} className="ring-2 ring-white dark:ring-zinc-900 rounded-full">
          <AgentAvatar name={agent.agentName} size={18} />
        </div>
      ))}
      {extra > 0 && (
        <div className="size-[18px] rounded-full bg-zinc-200 flex items-center justify-center text-[7px] font-medium text-zinc-600 ring-2 ring-white dark:ring-zinc-900">
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

interface ThreadListProps {
  /** When provided, this string drives the in-list search. Otherwise the
   *  list shows its own search input at the top. */
  externalSearchQuery?: string;
}

export function ThreadList({ externalSearchQuery }: ThreadListProps = {}) {
  const { sessions, currentSessionId, setCurrentSessionId, agents, lastMessageBySession, activeSessionIds, updateSession, renameSession } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const searchQuery = externalSearchQuery !== undefined ? externalSearchQuery : internalSearchQuery;
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

  // Sort sessions by backend last_event_at (stable, no client-side jumping)
  const sortedSessions = [...sessions]
    .filter((s) => s.status !== 'deleted')
    .sort((a, b) => {
      // Starred items first
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      const aTime = a.lastEventAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const bTime = b.lastEventAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return bTime - aTime;
    });

  // Routine channels (sessionId starts with `routines:`) live in their own
  // collapsible disclosure group at the bottom — same pattern as Swift's
  // ThreadListView. Strip them from the main active list.
  const activeSessions = sortedSessions.filter(
    (s) => s.status === 'active' && !s.sessionId.startsWith('routines:'),
  );
  // Archived sessions are reachable via per-row "Unarchive" only; Swift
  // doesn't surface them in the list and neither do we anymore.

  const filteredSessions = isSearching
    ? sortedSessions.filter((s) =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        hitsByChannel.has(s.sessionId)
      )
    : activeSessions;

  // Keyboard shortcuts:
  //   1-9  → open the Nth visible thread (mirrors monitor mode's 1-6)
  //   i    → focus the chat input of the current thread
  //   Esc  → handled inside chat-input (blurs the textarea)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack typing in any input/textarea, and skip when modifier
      // keys are held (so Cmd+1 / Ctrl+R / etc. still reach the browser).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target?.isContentEditable) return;

      // 1-9 → open thread by index (uses the same list the user is looking at).
      // Pass skipFocus so the chat input doesn't steal focus — the user is
      // navigating with the keyboard and presses 'i' explicitly to type.
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        const session = activeSessions[num - 1];
        if (session) {
          e.preventDefault();
          setCurrentSessionId(session.sessionId, { skipFocus: true });
          if (isMobile) openMobileDetail();
        }
        return;
      }

      // Any single printable character → focus the chat input and let the
      // keystroke pass through so the character appears in the textarea.
      // Only fires when a thread is open.
      if (e.key.length === 1 && currentSessionId) {
        const el = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
        if (el) {
          el.focus();
          // Don't preventDefault — let the character be typed into the textarea
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSessions, currentSessionId, isMobile, setCurrentSessionId, openMobileDetail]);

  return (
    <div className="flex flex-col h-full">
      {/* In-list search is only rendered when no external search is wired
          (the new sidebar-header owns the search input). The spinner over
          the workspace name handles the "searching" indicator when search
          is hoisted, so we don't need to surface it here. */}
      {externalSearchQuery === undefined && (
        <div className="flex items-center gap-1 px-3 pt-2 pb-1 shrink-0">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-input text-muted-foreground">
            <input
              type="text"
              placeholder="Search messages..."
              value={internalSearchQuery}
              onChange={(e) => setInternalSearchQuery(e.target.value)}
              className="text-xs bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
            />
            {searching && (
              <div className="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            )}
          </div>
        </div>
      )}

      {/* Thread rows */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        <div className="space-y-1">
          {filteredSessions.map((session) => {
            const isSelected = session.sessionId === currentSessionId;
            const lastMsg = lastMessageBySession[session.sessionId];
            const isActive = activeSessionIds.has(session.sessionId);
            const contentHit = hitsByChannel.get(session.sessionId);

            // Show last activity time from backend
            const activityMs = session.lastEventAt;
            const displayTime = activityMs
              ? timeAgo(new Date(activityMs).toISOString())
              : session.createdAt ? timeAgo(session.createdAt) : '';

            // Determine the preview line
            let preview: React.ReactNode;
            let previewIsStatus = false;
            if (isSearching && contentHit) {
              // Show matching snippet with highlight
              const snippet = contentHit.snippet.length > 80
                ? contentHit.snippet.slice(0, 80) + '...'
                : contentHit.snippet;
              preview = highlightMatch(snippet, searchQuery);
            } else if (lastMsg && lastMsg.content) {
              const sender = lastMsg.senderName === 'user' ? 'You' : lastMsg.senderName;
              if (lastMsg.isStatus) {
                previewIsStatus = true;
                // Parse "Using tool: <tool_name>" pattern from status messages
                const toolMatch = lastMsg.content.match(/Using tool:?\**\s*`?([^`\n]+)`?/i);
                if (toolMatch) {
                  // Clean MCP prefix: mcp__openagents-workspace__foo → foo, mcp__playwright__bar → bar
                  const rawTool = toolMatch[1].trim();
                  const cleanTool = rawTool.replace(/^mcp__[^_]+__/, '');
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
                  // Other status messages — strip markdown
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
            } else {
              preview = 'No messages yet';
            }

            return (
              <div
                key={session.sessionId}
                onClick={() => {
                  setCurrentSessionId(session.sessionId);
                  if (isMobile) openMobileDetail();
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors relative group cursor-pointer',
                  isSelected
                    ? 'bg-zinc-100 dark:bg-zinc-800 ring-2 ring-indigo-500 dark:ring-indigo-400'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                  'has-data-[state=open]:bg-zinc-50 dark:has-data-[state=open]:bg-zinc-800/50',
                )}
              >
                {/* Avatar stack — show only channel participants */}
                <div className="shrink-0">
                  <AvatarStack agents={
                    agents.filter((a) => session.participants.includes(a.agentName))
                  } />
                </div>

                {/* Content — title + activity time + preview. Swift's
                    ThreadRow has the same shape: starred star, title,
                    spacer, lastActivityLabel, and a 2-line preview. An
                    active session shows a tiny ProgressView next to the
                    title (mirrors Swift's ProgressView().controlSize(.mini)). */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    {session.starred && (
                      <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                    )}
                    <span className="text-sm flex-1 min-w-0 truncate font-normal text-foreground">
                      {isSearching
                        ? highlightMatch(session.title || 'Untitled', searchQuery)
                        : (session.title || 'Untitled')}
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

                {/* Hover actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="size-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = window.prompt('Rename chat', session.title || '');
                        const trimmed = next?.trim();
                        if (trimmed && trimmed !== session.title) {
                          renameSession(session.sessionId, trimmed);
                        }
                      }}
                    >
                      <Pencil className="size-4" />
                      <span>Rename</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSession(session.sessionId, { starred: !session.starred });
                      }}
                    >
                      <Star className={cn('size-4', session.starred && 'fill-amber-400 text-amber-400')} />
                      <span>{session.starred ? 'Unstar' : 'Star'}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSession(session.sessionId, { status: session.status === 'archived' ? 'active' : 'archived' });
                      }}
                    >
                      {session.status === 'archived'
                        ? <><ArchiveRestore className="size-4" /><span>Unarchive</span></>
                        : <><Archive className="size-4" /><span>Archive</span></>
                      }
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSession(session.sessionId, { status: 'deleted' });
                      }}
                    >
                      <Trash2 className="size-4" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
                  <p className="text-sm">No chats yet</p>
                  <p className="text-xs mt-1">Create a chat to start chatting</p>
                </>
              )}
            </div>
          )}

          {/* Routines disclosure — mirrors Swift's collapsible
              `DisclosureGroup` for `routines:*` channels. Hidden during
              search so search results don't get split across two
              sections. The Swift app doesn't surface Agent DMs or an
              archived-chats disclosure in ThreadListView; archive +
              unarchive are reached through the per-row context menu
              only, so both are dropped here too. */}
          {!isSearching && <RoutinesDisclosure />}
        </div>
      </div>
    </div>
  );
}
