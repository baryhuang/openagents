'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { LogIn, LogOut, Moon, Sun } from 'lucide-react';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { ThreadList } from '@/components/threads/thread-list';
import { InboxList, useInboxUnreadCount } from '@/components/threads/inbox-list';
import { SidebarHeader } from './sidebar-header';
import { cn } from '@/lib/utils';
import { isRoutineChannel } from '@/lib/helpers';

type SidebarTab = 'chats' | 'inbox';

// The whole sidebar = workspace header + search + tab switcher + the
// active tab's list + a thin footer with theme + user. Tabs are
// "Chats" (default — multi-user / DM threads) and "Inbox" (routines —
// system-managed per-agent activity feed).
export function SidebarContent() {
  const { user, isOpenAgentsDomain, signIn, signOut } = useOpenAgentsAuth();
  const { currentSessionId } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SidebarTab>('chats');
  const inboxUnread = useInboxUnreadCount();

  useEffect(() => {
    setMounted(true);
  }, []);

  // When the user navigates into a routine session (e.g. via deep link
  // or a notification surface added later), make sure the sidebar shows
  // the tab that owns it. Don't auto-flip back to Chats on its own —
  // the user picks Chats explicitly.
  useEffect(() => {
    if (isRoutineChannel(currentSessionId)) {
      setActiveTab('inbox');
    }
  }, [currentSessionId]);

  const isDark = mounted && theme === 'dark';
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  return (
    <div className="flex flex-col h-full min-h-0">
      <SidebarHeader searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      {/* Tab switcher — hidden while the user is searching, since search
          spans both surfaces and the dual-tab nav would be misleading. */}
      {!searchQuery && (
        <div className="shrink-0 px-3 pb-2">
          <div role="tablist" className="flex items-center gap-1 rounded-md bg-muted/40 p-0.5">
            <TabButton
              label="Chats"
              active={activeTab === 'chats'}
              onClick={() => setActiveTab('chats')}
            />
            <TabButton
              label="Inbox"
              active={activeTab === 'inbox'}
              onClick={() => setActiveTab('inbox')}
              badge={inboxUnread}
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {/* Search always lands on the chats list since cross-tab search
            isn't implemented yet — keeps current behavior intact. */}
        {searchQuery || activeTab === 'chats' ? (
          <ThreadList externalSearchQuery={searchQuery} />
        ) : (
          <InboxList />
        )}
      </div>

      {/* Footer — theme + user pill. Pinned to bottom. */}
      <div className="shrink-0 border-t border-border px-2 py-2 flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
          title={isDark ? 'Light mode' : 'Dark mode'}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>

        <div className="flex-1 min-w-0">
          {isOpenAgentsDomain && !user && (
            <button
              onClick={signIn}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors text-xs"
            >
              <LogIn className="size-3.5" />
              <span>Sign in</span>
            </button>
          )}
          {isOpenAgentsDomain && user && (
            <div className="flex items-center gap-1.5 px-1.5 py-1 min-w-0">
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoURL}
                  alt={user.displayName || user.email}
                  referrerPolicy="no-referrer"
                  className="size-5 rounded-full shrink-0 object-cover"
                />
              ) : (
                <div className="size-5 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[9px] font-bold shrink-0">
                  {user.email[0].toUpperCase()}
                </div>
              )}
              <span className="text-[11px] text-muted-foreground truncate flex-1">
                {user.email}
              </span>
              <button
                onClick={signOut}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="size-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            'min-w-[1.25rem] px-1.5 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center',
            active
              ? 'bg-indigo-500 text-white'
              : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300',
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}
