import React, { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import type { ChatMessage } from '../../types'
import MessageBubble from './MessageBubble'

interface MessageListProps {
  messages: ChatMessage[]
  pending: ChatMessage[]
  thinkingAgents: string[]
  onDownloadAttachment?: (fileId: string, filename: string) => void
}

export default function MessageList({
  messages,
  pending,
  thinkingAgents,
  onDownloadAttachment,
}: MessageListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showNewBadge, setShowNewBadge] = useState(false)
  const lastLengthRef = useRef(0)

  // Detect user scrolling away from bottom
  const onScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance < 80
    if (atBottom) {
      setAutoScroll(true)
      setShowNewBadge(false)
    } else {
      setAutoScroll(false)
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const total = messages.length + pending.length
    if (total === lastLengthRef.current) return
    const grew = total > lastLengthRef.current
    lastLengthRef.current = total

    if (autoScroll) {
      el.scrollTop = el.scrollHeight
    } else if (grew) {
      setShowNewBadge(true)
    }
  }, [messages.length, pending.length, autoScroll])

  const scrollToBottom = (): void => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setAutoScroll(true)
    setShowNewBadge(false)
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && pending.length === 0 && thinkingAgents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-(--text-tertiary) gap-2">
            <div className="text-3xl">💬</div>
            <div className="text-[13px]">No messages yet. Send something to start the conversation.</div>
            <div className="text-[11px]">Tip: use <code className="font-mono">@agent-name</code> to direct messages at a specific agent.</div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble
                key={m.messageId || `${m.senderName}:${m.createdAt}:${m.content.slice(0, 20)}`}
                message={m}
                onDownloadAttachment={onDownloadAttachment}
              />
            ))}
            {pending.map((m) => (
              <MessageBubble key={`pending-${m.messageId}`} message={m} isPending onDownloadAttachment={onDownloadAttachment} />
            ))}
            {thinkingAgents.length > 0 && (
              <div className="flex items-center gap-2 mt-2 text-[11px] text-(--text-tertiary)">
                <span className="inline-block w-2 h-2 rounded-full bg-(--accent) animate-pulse" />
                <span>{thinkingAgents.join(', ')} {thinkingAgents.length === 1 ? 'is' : 'are'} thinking…</span>
              </div>
            )}
          </>
        )}
      </div>
      {showNewBadge && (
        <button
          type="button"
          onClick={scrollToBottom}
          className={cn(
            'absolute bottom-3 right-4 z-10 rounded-full',
            'bg-(--accent) text-(--accent-text) text-[11px] font-semibold',
            'px-3 py-1.5 shadow-(--shadow-md) cursor-pointer',
            'hover:bg-(--accent-hover)',
          )}
        >
          ↓ New messages
        </button>
      )}
    </div>
  )
}
