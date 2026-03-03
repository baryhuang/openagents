'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SendHorizontal } from 'lucide-react';
import type { WorkspaceAgent } from '@/lib/types';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';

interface ChatInputProps {
  onSend: (content: string, mentions: string[]) => void;
  disabled?: boolean;
  className?: string;
  agents?: WorkspaceAgent[];
}

export function ChatInput({ onSend, disabled, className, agents = [] }: ChatInputProps) {
  const [message, setMessage] = React.useState('');
  const [showMentions, setShowMentions] = React.useState(false);
  const [mentionFilter, setMentionFilter] = React.useState('');
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const agentNames = agents.map((a) => a.agentName);

  // Extract @mentions from message text
  const extractMentions = (text: string): string[] => {
    const matches = text.match(/@([\w-]+)/g) || [];
    return matches
      .map((m) => m.slice(1))
      .filter((name) => agentNames.includes(name));
  };

  const filteredAgents = agents.filter((a) =>
    a.agentName.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    const mentions = extractMentions(trimmed);
    onSend(trimmed, mentions);
    setMessage('');
    setShowMentions(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const insertMention = (agentName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = message.slice(0, cursorPos);
    const textAfter = message.slice(cursorPos);

    // Find the @ that triggered the mention
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return;

    const newText = textBefore.slice(0, atIndex) + `@${agentName} ` + textAfter;
    setMessage(newText);
    setShowMentions(false);
    setMentionFilter('');

    // Restore focus
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = atIndex + agentName.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredAgents.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredAgents.length) % filteredAgents.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredAgents[mentionIndex].agentName);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentions(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea + detect @mentions
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;

    // Detect @mention trigger
    const cursorPos = textarea.selectionStart;
    const textBefore = value.slice(0, cursorPos);
    const atMatch = textBefore.match(/@([\w-]*)$/);
    if (atMatch && agents.length > 1) {
      setMentionFilter(atMatch[1]);
      setMentionIndex(0);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      {/* @mention autocomplete dropdown */}
      {showMentions && filteredAgents.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 right-0 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden">
          {filteredAgents.map((agent, i) => {
            const color = getAgentColor(agent.agentName, agentNames);
            return (
              <button
                key={agent.agentName}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                  i === mentionIndex && 'bg-accent'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(agent.agentName);
                }}
              >
                <div className={cn('size-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold', color.initials)}>
                  {getAgentInitials(agent.agentName)}
                </div>
                <span className="font-medium">{agent.agentName}</span>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full ml-auto',
                  agent.role === 'master'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                )}>
                  {agent.role}
                </span>
                <span className={cn(
                  'size-2 rounded-full',
                  agent.status === 'online' ? 'bg-green-500' : 'bg-zinc-400'
                )} />
              </button>
            );
          })}
        </div>
      )}

      <div className="relative flex flex-col gap-2 bg-background transition-all rounded-2xl border shadow-lg p-4">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={agents.length > 1 ? 'Message... (use @ to mention an agent)' : 'Message...'}
          rows={1}
          disabled={disabled}
          className="flex-1 border-0 bg-transparent shadow-none focus:outline-none placeholder:text-muted-foreground h-auto px-0 text-sm py-2 resize-none"
        />

        <div className="flex items-center justify-end">
          <Button
            variant={message.trim() ? 'primary' : 'secondary'}
            size="icon"
            className={cn(
              'size-9 rounded-xl transition-all',
              message.trim() ? 'opacity-100' : 'opacity-50'
            )}
            onClick={handleSend}
            disabled={!message.trim() || disabled}
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
