import React from 'react'
import { cn } from '../../lib/utils'
import type { ChatSessionMeta, Workspace } from '../../types'

interface SessionListProps {
  workspaces: Workspace[]
  sessions: ChatSessionMeta[]
  activeKey: string | null
  selectedWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSession: (workspaceId: string, channelName: string) => void
  onDeleteSession: (workspaceId: string, channelName: string) => void
  onClearAll: () => void
  onNewChat: () => void
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!t) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`
  return `${Math.round(diff / 86_400_000)}d`
}

export default function SessionList({
  workspaces,
  sessions,
  activeKey,
  selectedWorkspaceId,
  onSelectWorkspace,
  onSelectSession,
  onDeleteSession,
  onClearAll,
  onNewChat,
}: SessionListProps): React.JSX.Element {
  const filtered = selectedWorkspaceId
    ? sessions.filter((s) => s.workspaceId === selectedWorkspaceId)
    : sessions

  return (
    <aside className="w-[260px] shrink-0 h-full border-r border-(--border) bg-(--bg-sidebar) flex flex-col">
      <div className="px-3 py-3 border-b border-(--border)">
        <label className="block text-[10px] uppercase tracking-wider text-(--text-tertiary) mb-1">Workspace</label>
        <select
          value={selectedWorkspaceId || ''}
          onChange={(e) => onSelectWorkspace(e.target.value)}
          className="w-full text-[12px] px-2 py-1.5 rounded-sm bg-(--bg-input) border border-(--border) text-(--text-primary)"
        >
          <option value="">— select workspace —</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name || w.slug}</option>
          ))}
        </select>
        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={onNewChat}
            disabled={!selectedWorkspaceId}
            className={cn(
              'flex-1 text-[11px] font-medium px-2 py-1.5 rounded-sm cursor-pointer',
              'bg-(--accent) text-(--accent-text) hover:bg-(--accent-hover)',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            + New chat
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="text-[11px] px-2 py-1.5 rounded-sm bg-(--bg-card) border border-(--border) cursor-pointer text-(--text-secondary) hover:text-(--danger-text)"
            title="Clear all sessions for this workspace"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-(--text-tertiary) text-center">
            No saved sessions yet.
          </div>
        ) : (
          filtered.map((s) => {
            const key = `${s.workspaceId}:${s.channelName}`
            const active = activeKey === key
            return (
              <div
                key={key}
                onClick={() => onSelectSession(s.workspaceId, s.channelName)}
                className={cn(
                  'group cursor-pointer rounded-sm px-2.5 py-2 mb-1 transition-colors',
                  active ? 'bg-(--accent) text-(--accent-text)' : 'hover:bg-(--bg-card) text-(--text-primary)',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold truncate">{s.title}</span>
                  <span className={cn(
                    'text-[10px] shrink-0',
                    active ? 'text-(--accent-text) opacity-80' : 'text-(--text-tertiary)',
                  )}>{relativeTime(s.lastMessageAt)}</span>
                </div>
                {s.lastMessagePreview && (
                  <div className={cn(
                    'text-[11px] truncate mt-0.5',
                    active ? 'text-(--accent-text) opacity-80' : 'text-(--text-secondary)',
                  )}>{s.lastMessagePreview}</div>
                )}
                <div className="flex items-center justify-between mt-1">
                  <span className={cn(
                    'text-[10px]',
                    active ? 'text-(--accent-text) opacity-70' : 'text-(--text-tertiary)',
                  )}>#{s.channelName} · {s.messageCount} msg</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(s.workspaceId, s.channelName) }}
                    className={cn(
                      'opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded cursor-pointer',
                      active ? 'bg-white/20 text-white' : 'bg-(--bg-input) text-(--text-tertiary) hover:text-(--danger-text)',
                    )}
                  >Delete</button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
