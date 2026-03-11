'use client';

import { cn } from '@/lib/utils';
import { ChatMessage } from './chat-message';
import { IntermediateSteps } from './intermediate-steps';
import { Button } from '@/components/ui/button';
import { ArrowDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';

// ── Message Grouping ──

type MessageGroup =
  | { type: 'chat'; message: WorkspaceMessage }
  | { type: 'steps'; messages: WorkspaceMessage[] };

function groupMessages(messages: WorkspaceMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentSteps: WorkspaceMessage[] = [];

  const flushSteps = () => {
    if (currentSteps.length > 0) {
      groups.push({ type: 'steps', messages: [...currentSteps] });
      currentSteps = [];
    }
  };

  messages.forEach((msg) => {
    if (msg.messageType === 'status' || msg.messageType === 'thinking') {
      currentSteps.push(msg);
    } else {
      flushSteps();
      groups.push({ type: 'chat', message: msg });
    }
  });

  flushSteps();
  return groups;
}

// ── Component ──

interface ChatMessagesProps {
  messages: WorkspaceMessage[];
  agents?: WorkspaceAgent[];
  showAllSteps: boolean;
  className?: string;
}

export function ChatMessages({ messages, agents, showAllSteps, className }: ChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  const prevLengthRef = useRef(0);

  // Filter: skip empty status messages; when toggle is off, only show status messages after the last chat message
  const filteredMessages = useMemo(() => {
    const isStep = (msg: WorkspaceMessage) => msg.messageType === 'status' || msg.messageType === 'thinking';
    const nonEmpty = messages.filter((msg) => !isStep(msg) || msg.content.trim());
    if (showAllSteps) return nonEmpty;

    let lastChatIndex = -1;
    for (let i = nonEmpty.length - 1; i >= 0; i--) {
      if (!isStep(nonEmpty[i])) {
        lastChatIndex = i;
        break;
      }
    }

    // Check if the very last message is a step (agent still working)
    const lastIsStep = nonEmpty.length > 0 && isStep(nonEmpty[nonEmpty.length - 1]);

    // Keep: all non-step messages, all thinking messages (they persist),
    // and trailing status only if agent is still actively working
    const trailing = nonEmpty.filter((msg, index) => {
      if (!isStep(msg)) return true;
      // Always keep thinking messages — they provide reasoning context
      if (msg.messageType === 'thinking') return true;
      // Only keep trailing status if agent is still working
      // (last message is a step, meaning no chat response yet)
      return lastIsStep && index > lastChatIndex;
    });
    // Find the last status-only message and keep only that one
    let lastStatusIndex = -1;
    for (let i = trailing.length - 1; i >= 0; i--) {
      if (trailing[i].messageType === 'status') {
        lastStatusIndex = i;
        break;
      }
    }
    return trailing.filter((msg, index) => {
      if (msg.messageType !== 'status') return true;
      return index === lastStatusIndex;
    });
  }, [messages, showAllSteps]);

  // Group into chat messages and intermediate step clusters
  const groups = useMemo(() => groupMessages(filteredMessages), [filteredMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const wasEmpty = prevLengthRef.current === 0;
    prevLengthRef.current = messages.length;

    // Always scroll on initial load; otherwise only if near bottom
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (wasEmpty || isNearBottom) {
      // Use rAF to ensure DOM has been laid out with the new content
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [messages.length]);

  // Track scroll position for "scroll to bottom" button
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setShowScrollBtn(!isNearBottom);
    };

    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        className={cn('flex flex-col h-full overflow-y-auto space-y-1', className)}
      >
        {groups.map((group, gi) => {
          if (group.type === 'chat') {
            return (
              <ChatMessage
                key={group.message.messageId}
                message={group.message}
                agents={agents}
              />
            );
          }
          const isTrailing = gi === groups.length - 1;
          return (
            <IntermediateSteps
              key={`steps-${group.messages[0].messageId}`}
              steps={group.messages}
              agents={agents}
              isActive={isTrailing}
            />
          );
        })}
      </div>

      {showScrollBtn && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full shadow-lg"
            onClick={scrollToBottom}
          >
            <ArrowDown className="size-4 mr-1" />
            New messages
          </Button>
        </div>
      )}
    </div>
  );
}
