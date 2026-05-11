'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Loader2, Timer } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import type { TimerItem } from '@/lib/types';

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

export function ThreadStatusBar({ channelName }: { channelName: string }) {
  const { todos } = useWorkspace();
  const [timers, setTimers] = useState<TimerItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await workspaceApi.listTimers(channelName);
        if (!cancelled) setTimers(result.timers);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [channelName]);

  // Refresh countdown every second when timers are active
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timers.length) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [timers.length]);

  const channelTodos = useMemo(() =>
    todos.filter((t) => t.channelName === channelName && (t.status === 'pending' || t.status === 'in_progress')),
    [todos, channelName]
  );

  const pendingCount = channelTodos.filter((t) => t.status === 'pending').length;
  const inProgressCount = channelTodos.filter((t) => t.status === 'in_progress').length;
  const activeTimers = timers.filter((t) => t.status === 'active');

  if (pendingCount === 0 && inProgressCount === 0 && activeTimers.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-1 py-1 text-[11px] text-muted-foreground">
      {inProgressCount > 0 && (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 text-blue-500 animate-spin" />
          {inProgressCount} in progress
        </span>
      )}
      {pendingCount > 0 && (
        <span className="flex items-center gap-1">
          <Circle className="size-3" />
          {pendingCount} pending
        </span>
      )}
      {activeTimers.map((t) => (
        <span key={t.id} className="flex items-center gap-1">
          <Timer className="size-3 text-amber-500" />
          {t.message.length > 30 ? t.message.slice(0, 30) + '…' : t.message}
          <span className="text-amber-500 font-mono">{timeUntil(t.firesAt)}</span>
        </span>
      ))}
    </div>
  );
}
