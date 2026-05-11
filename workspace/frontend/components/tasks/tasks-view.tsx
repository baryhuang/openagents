'use client';

import { useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ListTodo, CheckCircle2, Circle, Loader2, RefreshCw } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';
import type { TodoItem } from '@/lib/types';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />;
  if (status === 'in_progress') return <Loader2 className="size-4 text-blue-500 shrink-0 animate-spin" />;
  return <Circle className="size-4 text-zinc-400 shrink-0" />;
}

interface GroupedTodos {
  channelName: string;
  channelTitle: string;
  agentName: string;
  pending: TodoItem[];
  inProgress: TodoItem[];
  completed: TodoItem[];
}

export function TasksView() {
  const { todos, refreshTodos, sessions, agents } = useWorkspace();
  const agentNames = useMemo(() => agents.map((a) => a.agentName), [agents]);

  useEffect(() => {
    refreshTodos();
  }, [refreshTodos]);

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const { activeGroups, recentCompleted } = useMemo(() => {
    const activeItems = todos.filter((t) => t.status !== 'completed');
    const completedItems = todos.filter(
      (t) => t.status === 'completed' && t.updatedAt && now - new Date(t.updatedAt).getTime() < oneDayMs
    );

    const groupMap = new Map<string, GroupedTodos>();
    for (const t of [...activeItems, ...completedItems]) {
      const key = `${t.channelName}:${t.createdBy}`;
      if (!groupMap.has(key)) {
        const session = sessions.find((s) => s.sessionId === t.channelName);
        const agentName = t.createdBy.replace('openagents:', '');
        groupMap.set(key, {
          channelName: t.channelName,
          channelTitle: session?.title || t.channelName,
          agentName,
          pending: [],
          inProgress: [],
          completed: [],
        });
      }
      const group = groupMap.get(key)!;
      if (t.status === 'completed') group.completed.push(t);
      else if (t.status === 'in_progress') group.inProgress.push(t);
      else group.pending.push(t);
    }

    const groups = Array.from(groupMap.values());
    const active = groups.filter((g) => g.pending.length > 0 || g.inProgress.length > 0);
    const completed = groups.filter((g) => g.completed.length > 0);

    active.sort((a, b) => b.inProgress.length - a.inProgress.length);

    return { activeGroups: active, recentCompleted: completed };
  }, [todos, sessions, now, oneDayMs]);

  const totalActive = todos.filter((t) => t.status !== 'completed').length;
  const totalInProgress = todos.filter((t) => t.status === 'in_progress').length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="size-4 text-indigo-500" />
          <h2 className="text-sm font-semibold">Tasks</h2>
          {totalActive > 0 && (
            <span className="text-xs text-muted-foreground">
              {totalActive} active{totalInProgress > 0 && ` · ${totalInProgress} in progress`}
            </span>
          )}
        </div>
        <button
          onClick={refreshTodos}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <ListTodo className="size-8 opacity-30" />
            <p className="text-sm">No tasks yet</p>
            <p className="text-xs opacity-60">Agent to-do lists will appear here</p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {/* Active tasks */}
            {activeGroups.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Active</h3>
                <div className="space-y-4">
                  {activeGroups.map((group) => (
                    <TaskGroup key={`${group.channelName}:${group.agentName}`} group={group} showCompleted={false} agentNames={agentNames} />
                  ))}
                </div>
              </div>
            )}

            {/* Recently completed */}
            {recentCompleted.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Completed (last 24h)
                </h3>
                <div className="space-y-4">
                  {recentCompleted.map((group) => (
                    <TaskGroup key={`done-${group.channelName}:${group.agentName}`} group={group} showCompleted={true} agentNames={agentNames} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskGroup({ group, showCompleted, agentNames }: { group: GroupedTodos; showCompleted: boolean; agentNames: string[] }) {
  const items = showCompleted
    ? group.completed
    : [...group.inProgress, ...group.pending];

  const agentColor = getAgentColor(group.agentName, agentNames);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Group header */}
      <div className="px-3 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
        <div
          className="size-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
          style={{ backgroundColor: agentColor.bg }}
        >
          {getAgentInitials(group.agentName)}
        </div>
        <span className="text-xs font-medium truncate">{group.agentName}</span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground truncate">{group.channelTitle}</span>
      </div>

      {/* Items */}
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div key={item.id} className="px-3 py-2 flex items-start gap-2.5">
            <StatusIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <span className={cn(
                'text-sm leading-snug',
                item.status === 'completed' && 'line-through text-muted-foreground'
              )}>
                {item.content}
              </span>
              {item.assignee && item.assignee !== group.agentName && (
                <span className="text-xs text-muted-foreground ml-1.5">→ {item.assignee}</span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0 pt-0.5">
              {timeAgo(item.updatedAt || item.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
