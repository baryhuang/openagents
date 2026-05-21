'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { LogIn, LogOut, Moon, Sun } from 'lucide-react';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { ThreadList } from '@/components/threads/thread-list';
import { SidebarHeader } from './sidebar-header';

// The whole sidebar = workspace header + search + thread list (with the
// routines disclosure baked in at the bottom) + a thin footer with theme
// + user. Mirrors Swift's `ThreadListView` body, plus a compact account
// row at the very bottom (no Swift equivalent — Swift handles auth
// outside the workspace view).
export function SidebarContent() {
  const { user, isOpenAgentsDomain, signIn, signOut } = useOpenAgentsAuth();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && theme === 'dark';
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  return (
    <div className="flex flex-col h-full min-h-0">
      <SidebarHeader searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <div className="flex-1 min-h-0">
        <ThreadList externalSearchQuery={searchQuery} />
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
              <div className="size-5 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[9px] font-bold shrink-0">
                {user.email[0].toUpperCase()}
              </div>
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
