'use client';

import { Bot } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <div className="flex items-center p-4 rounded-full bg-primary/10">
        <Bot className="size-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Start a conversation</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Send a message to start chatting with your agent.
          Messages will appear here in real time.
        </p>
      </div>
    </div>
  );
}
