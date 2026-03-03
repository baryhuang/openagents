'use client';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Copy, User } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { getAgentColor, getAgentInitials, type AgentColor } from '@/lib/helpers';
import { JSX } from 'react';

interface ChatMessageProps {
  message: WorkspaceMessage;
  agents?: WorkspaceAgent[];
}

export function ChatMessage({ message, agents = [] }: ChatMessageProps) {
  const isHuman = message.senderType === 'human';
  const isSystem = message.messageType === 'status';

  const agentNames = agents.map((a) => a.agentName);
  const agentColor = !isHuman ? getAgentColor(message.senderName, agentNames) : null;
  const agent = agents.find((a) => a.agentName === message.senderName);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy');
    }
  };

  // Status messages
  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-muted-foreground italic">
          {message.senderName}: {message.content}
        </span>
      </div>
    );
  }

  // Parse content into structured HTML elements
  const renderContent = () => {
    const lines = message.content.split('\n');
    const elements: JSX.Element[] = [];
    let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;

    const flushList = () => {
      if (currentList) {
        if (currentList.type === 'ul') {
          elements.push(
            <ul key={`ul-${elements.length}`} className="my-3 space-y-1.5">
              {currentList.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 pl-1">
                  <span className="mt-2 size-1 rounded-full bg-current shrink-0 opacity-70" />
                  <span className="flex-1">{parseInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        } else {
          elements.push(
            <ol key={`ol-${elements.length}`} className="my-3 space-y-1.5">
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
      // Bold + @mentions
      const parts = text.split(/(\*\*.*?\*\*|@[\w-]+)/g);
      return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-muted-foreground">{part.slice(2, -2)}</strong>;
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
          elements.push(<div key={`space-${index}`} className="h-3" />);
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
          <h3 key={index} className="font-bold text-[15px] mt-5 mb-2.5 first:mt-0 text-muted-foreground">
            {headerText}
          </h3>
        );
        return;
      }

      flushList();
      elements.push(
        <p key={index} className="my-1 leading-relaxed">
          {parseInline(line)}
        </p>
      );
    });

    flushList();
    return elements;
  };

  return (
    <div className={cn('flex items-start gap-3 py-4', isHuman && 'flex-row-reverse')}>
      {isHuman ? (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-secondary">
            <User className="size-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      ) : (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className={cn(agentColor?.initials, 'text-white text-xs font-bold')}>
            {getAgentInitials(message.senderName)}
          </AvatarFallback>
        </Avatar>
      )}

      <div className={cn('flex flex-col gap-1 flex-1', isHuman && 'items-end')}>
        {/* Sender name label + role badge for agent messages */}
        {!isHuman && (
          <div className="flex items-center gap-1.5 px-1">
            <span className={cn('text-xs font-medium', agentColor?.text)}>
              {message.senderName}
            </span>
            {agent && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                agent.role === 'master'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              )}>
                {agent.role}
              </span>
            )}
          </div>
        )}

        <div
          className={cn(
            'rounded-2xl px-5 py-3.5 text-sm shadow-sm relative group',
            isHuman
              ? 'bg-primary text-primary-foreground max-w-[85%] rounded-br-sm'
              : cn('max-w-[90%] rounded-bl-sm', agentColor?.bg, `border ${agentColor?.border}`)
          )}
        >
          <div className="text-sm">{renderContent()}</div>

          {/* Copy action for agent messages */}
          {!isHuman && (
            <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 h-7 text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={handleCopy}
                title="Copy"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          )}
        </div>

        {message.createdAt && (
          <span className="text-xs text-muted-foreground px-1">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}
