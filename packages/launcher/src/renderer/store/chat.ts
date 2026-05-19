import { create } from 'zustand'
import type {
  ChatMessage,
  ChatSessionMeta,
  WorkspaceParticipant,
  FileListEntry,
} from '../types'

export interface ActiveChannel {
  workspaceId: string
  workspaceName?: string
  channelName: string
}

interface ChatState {
  // Active context
  active: ActiveChannel | null
  setActive: (active: ActiveChannel | null) => void

  // Messages keyed by `${workspaceId}:${channelName}`
  messages: Record<string, ChatMessage[]>
  setMessages: (key: string, messages: ChatMessage[]) => void
  appendMessage: (key: string, message: ChatMessage) => void
  clearMessages: (key: string) => void

  // Optimistic / streaming markers for in-flight messages
  pendingMessages: Record<string, ChatMessage[]>
  addPending: (key: string, msg: ChatMessage) => void
  removePending: (key: string, messageId: string) => void

  // Agent thinking state per channel
  thinkingAgents: Record<string, Set<string>>
  setThinking: (key: string, agent: string, thinking: boolean) => void

  // Sessions
  sessions: ChatSessionMeta[]
  setSessions: (sessions: ChatSessionMeta[]) => void

  // Participants per workspace
  participants: Record<string, WorkspaceParticipant[]>
  setParticipants: (workspaceId: string, participants: WorkspaceParticipant[]) => void

  // Files per workspace (attachment dialog)
  files: Record<string, FileListEntry[]>
  setFiles: (workspaceId: string, files: FileListEntry[]) => void

  // Auto-scroll behaviour
  autoScrollEnabled: boolean
  setAutoScrollEnabled: (enabled: boolean) => void
}

export function channelKey(workspaceId: string, channelName: string): string {
  return `${workspaceId}:${channelName}`
}

export const useChatStore = create<ChatState>((set) => ({
  active: null,
  setActive: (active) => set({ active }),

  messages: {},
  setMessages: (key, messages) =>
    set((s) => ({ messages: { ...s.messages, [key]: dedupeMessages(messages) } })),
  appendMessage: (key, message) =>
    set((s) => {
      const list = s.messages[key] || []
      if (message.messageId && list.some((m) => m.messageId === message.messageId)) {
        // Already present — replace to pick up later updates (e.g. tool results)
        return { messages: { ...s.messages, [key]: list.map((m) => (m.messageId === message.messageId ? message : m)) } }
      }
      return { messages: { ...s.messages, [key]: [...list, message] } }
    }),
  clearMessages: (key) =>
    set((s) => {
      const next = { ...s.messages }
      delete next[key]
      return { messages: next }
    }),

  pendingMessages: {},
  addPending: (key, msg) =>
    set((s) => ({
      pendingMessages: { ...s.pendingMessages, [key]: [...(s.pendingMessages[key] || []), msg] },
    })),
  removePending: (key, messageId) =>
    set((s) => ({
      pendingMessages: {
        ...s.pendingMessages,
        [key]: (s.pendingMessages[key] || []).filter((m) => m.messageId !== messageId),
      },
    })),

  thinkingAgents: {},
  setThinking: (key, agent, thinking) =>
    set((s) => {
      const current = new Set(s.thinkingAgents[key] || [])
      if (thinking) current.add(agent)
      else current.delete(agent)
      return { thinkingAgents: { ...s.thinkingAgents, [key]: current } }
    }),

  sessions: [],
  setSessions: (sessions) => set({ sessions }),

  participants: {},
  setParticipants: (workspaceId, participants) =>
    set((s) => ({ participants: { ...s.participants, [workspaceId]: participants } })),

  files: {},
  setFiles: (workspaceId, files) =>
    set((s) => ({ files: { ...s.files, [workspaceId]: files } })),

  autoScrollEnabled: true,
  setAutoScrollEnabled: (enabled) => set({ autoScrollEnabled: enabled }),
}))

function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>()
  const out: ChatMessage[] = []
  for (const m of messages) {
    const id = m.messageId || `${m.senderName}:${m.createdAt}:${out.length}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(m)
  }
  return out
}
