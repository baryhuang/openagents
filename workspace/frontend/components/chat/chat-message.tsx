'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Copy, Check, User } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';
import { JSX } from 'react';

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

  // Parse content into structured elements
  const renderContent = () => {
    const lines = message.content.split('\n');
    const elements: JSX.Element[] = [];
    let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;

    const flushList = () => {
      if (currentList) {
        if (currentList.type === 'ul') {
          elements.push(
            <ul key={`ul-${elements.length}`} className="my-2 space-y-1">
              {currentList.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 pl-1">
                  <span className="mt-2 size-1 rounded-full bg-current shrink-0 opacity-50" />
                  <span className="flex-1">{parseInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        } else {
          elements.push(
            <ol key={`ol-${elements.length}`} className="my-2 space-y-1">
              {currentList.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 pl-1">
                  <span className="font-medium text-muted-foreground text-sm shrink-0">{i + 1}.</span>
                  <span className="flex-1">{parseInline(item)}</span>
                </li>
              ))}
            </ol>
          );
        }
        currentList = null;
      }
    };

    const parseInline = (text: string) => {
      const parts = text.split(/(\*\*.*?\*\*|`[^`]+`|@[\w-]+)/g);
      return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="text-[13px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('@') && agentNames.includes(part.slice(1))) {
          const mentionColor = getAgentColor(part.slice(1), agentNames);
          return (
            <span key={i} className={cn('font-medium rounded px-0.5', mentionColor.text)}>
              {part}
            </span>
          );
        }
        return part;
      });
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      if (!trimmed) {
        flushList();
        if (elements.length > 0) {
          elements.push(<div key={`space-${index}`} className="h-2" />);
        }
        return;
      }

      if (trimmed.match(/^[•\-*\.]\s/)) {
        const content = trimmed.replace(/^[•\-*\.]\s*/, '');
        if (!currentList || currentList.type !== 'ul') {
          flushList();
          currentList = { type: 'ul', items: [] };
        }
        currentList.items.push(content);
        return;
      }

      const numberMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (numberMatch) {
        const content = numberMatch[2];
        if (!currentList || currentList.type !== 'ol') {
          flushList();
          currentList = { type: 'ol', items: [] };
        }
        currentList.items.push(content);
        return;
      }

      if ((trimmed.startsWith('**') && trimmed.endsWith('**')) || trimmed.startsWith('###')) {
        flushList();
        const headerText = trimmed.replace(/^###\s*/, '').replace(/^\*\*|\*\*$/g, '');
        elements.push(
          <h3 key={index} className="font-semibold text-[15px] mt-4 mb-1.5 first:mt-0">
            {headerText}
          </h3>
        );
        return;
      }

      flushList();
      elements.push(
        <p key={index} className="leading-relaxed">
          {parseInline(line)}
        </p>
      );
    });

    flushList();
    return elements;
  };

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
            <div className="text-sm leading-relaxed mt-0.5">{renderContent()}</div>
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
            {renderContent()}

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
