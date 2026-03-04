'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Copy, Check, User } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';
import { MarkdownContent } from './markdown-content';

interface ChatMessageProps {
  message: WorkspaceMessage;
  agents?: WorkspaceAgent[];
}

export function ChatMessage({ message, agents = [] }: ChatMessageProps) {
  const isHuman = message.senderType === 'human';
  const isSystem = message.messageType === 'status';
  const [copied, setCopied] = useState(false);

  const agentNames = agents.map((a) => a.agentName);
  const agentColor = !isHuman ? getAgentColor(message.senderName, agentNames) : null;
  const agent = agents.find((a) => a.agentName === message.senderName);

  const timestamp = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  // Status messages — subtle inline
  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-muted-foreground italic">
          {message.senderName}: {message.content}
        </span>
      </div>
    );
  }

  // ── Human message — Slack style ──
  if (isHuman) {
    return (
      <div className="py-1.5">
        <div className="flex items-start gap-2">
          <div className="size-9 rounded-lg shrink-0 flex items-center justify-center bg-zinc-200 dark:bg-zinc-700 mt-0.5">
            <User className="size-4 text-zinc-500 dark:text-zinc-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] font-bold text-foreground">You</span>
              {timestamp && (
                <span className="text-xs text-muted-foreground">{timestamp}</span>
              )}
            </div>
            <div className="text-sm leading-relaxed mt-0.5">
              <MarkdownContent content={message.content} agentNames={agentNames} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Agent message — Slack style ──
  return (
    <div className="py-1.5">
      <div className="flex items-start gap-2">
        <div className={cn(
          'size-9 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-bold mt-0.5',
          agentColor?.initials
        )}>
          {getAgentInitials(message.senderName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-foreground truncate">
              {message.senderName}
            </span>
            {agent && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0',
                agent.role === 'master'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              )}>
                {agent.role}
              </span>
            )}
            {timestamp && (
              <span className="text-xs text-muted-foreground">{timestamp}</span>
            )}
          </div>
          <div className="text-sm leading-relaxed mt-0.5">
            <MarkdownContent content={message.content} agentNames={agentNames} />

            {/* Copy button */}
            <div className="flex items-center gap-1 mt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                onClick={handleCopy}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
