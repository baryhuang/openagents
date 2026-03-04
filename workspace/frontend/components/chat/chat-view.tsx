'use client';

import { useCallback, useState, useEffect } from 'react';
import { ChatMessages } from './chat-messages';
import { ChatInput } from './chat-input';
import { EmptyState } from './empty-state';
import { useWorkspace } from '@/lib/workspace-context';
import { useMessagePolling } from '@/hooks/use-polling';
import { workspaceApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ListTree, UserPlus, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';

export function ChatView() {
  const { agents, currentSessionId, sessions, updateLastMessage, setSessionActive } = useWorkspace();
  const { messages, loading, forceRefresh } = useMessagePolling({
    sessionId: currentSessionId,
  });
  const [showAllSteps, setShowAllSteps] = useState(false);

  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);
  const agentNames = agents.map((a) => a.agentName);

  // Update last message cache for thread list preview
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;
    const chatMessages = messages.filter((m) => m.messageType !== 'status');
    const lastChat = chatMessages[chatMessages.length - 1];
    if (lastChat) {
      updateLastMessage(currentSessionId, lastChat.senderName, lastChat.content);
    }
  }, [currentSessionId, messages, updateLastMessage]);

  // Track whether the agent is actively working in this session
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) {
      if (currentSessionId) setSessionActive(currentSessionId, false);
      return;
    }
    const lastMsg = messages[messages.length - 1];
    const isAgentWorking = lastMsg.senderType === 'agent' && lastMsg.messageType === 'status';
    setSessionActive(currentSessionId, isAgentWorking);
  }, [currentSessionId, messages, setSessionActive]);

  const handleSend = useCallback(
    async (content: string, mentions: string[] = []) => {
      if (!currentSessionId) return;
      try {
        await workspaceApi.sendMessage(currentSessionId, content, 'user', mentions.length > 0 ? mentions : undefined);
        forceRefresh();
      } catch {
        // Error is visible via missing message
      }
    },
    [currentSessionId, forceRefresh]
  );

  const hasStatusMessages = messages.some((m) => m.messageType === 'status');

  if (!currentSessionId) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
        <div className="opacity-20 mb-3">
          <MessageSquare className="size-10" />
        </div>
        <p className="text-sm font-medium">Select a thread</p>
        <p className="text-xs mt-1">Choose a thread from the list or create a new one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold truncate">{currentSession?.title || 'Thread'}</h2>
          {agents.length > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium shrink-0">
              group
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Participant chips */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {agents.map((agent) => {
              const color = getAgentColor(agent.agentName, agentNames);
              const isMaster = agent.role === 'master';
              return (
                <div
                  key={agent.agentName}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted border shrink-0"
                >
                  <div className={cn(
                    'size-4 rounded-full flex items-center justify-center text-white text-[7px] font-bold',
                    color.initials
                  )}>
                    {getAgentInitials(agent.agentName)}
                  </div>
                  <span className="text-[11px] font-medium">{agent.agentName.split('-')[0]}</span>
                  {isMaster && (
                    <span className="text-[8px] px-1 py-0 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-semibold">
                      M
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* All steps toggle */}
          {hasStatusMessages && (
            <Button
              variant={showAllSteps ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setShowAllSteps((prev) => !prev)}
              className={cn(
                'gap-1.5 h-7 text-xs font-medium',
                showAllSteps && 'border-primary/30 text-primary bg-primary/5'
              )}
              title={showAllSteps ? 'Showing all intermediate steps' : 'Showing only latest steps'}
            >
              <ListTree className="size-3.5" />
            </Button>
          )}

          {/* Add agent button */}
          <button
            className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-primary transition-colors"
            title="Add agent to thread"
          >
            <UserPlus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          <ChatMessages
            messages={messages}
            agents={agents}
            showAllSteps={showAllSteps}
            className="flex-1 overflow-y-auto px-5 py-3"
          />
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t">
          <div className="max-w-3xl mx-auto w-full">
            <ChatInput
              onSend={handleSend}
              agents={agents}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
