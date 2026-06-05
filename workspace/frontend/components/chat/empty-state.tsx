'use client';

import { useState } from 'react';
import { Bot, Cloud, Terminal, Rocket, CheckCircle2, ChevronRight, Copy, Check } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

function StepBadge({ number, done }: { number: number; done: boolean }) {
  if (done) {
    return (
      <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white shrink-0">
        <CheckCircle2 className="size-4" />
      </div>
    );
  }
  return (
    <div className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
      {number}
    </div>
  );
}

export function EmptyState() {
  const { agents, token } = useWorkspace();
  const { setViewMode } = useLayout();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const hasAgents = agents.length > 0;
  const hasOnlineAgent = agents.some((a) => a.status === 'online');

  if (hasOnlineAgent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <div className="flex items-center p-4 rounded-full bg-emerald-500/10">
          <Rocket className="size-8 text-emerald-500" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">You&apos;re all set!</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your agent is online. Send a message below to start collaborating.
            Use <span className="font-medium text-foreground">@agent-name</span> to delegate tasks.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 sm:p-8">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center p-3 rounded-full bg-primary/10 mx-auto w-fit">
            <Bot className="size-7 text-primary" />
          </div>
          <h3 className="text-xl font-semibold">Welcome to your workspace</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Follow these steps to connect your first agent and start collaborating.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {/* Step 1: Workspace created (always done) */}
          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
            <StepBadge number={1} done />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Workspace created</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your workspace is ready. You can share the URL to invite others.
              </p>
            </div>
          </div>

          {/* Step 2: Connect an agent */}
          <div className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
            hasAgents ? 'bg-card' : 'bg-primary/[0.02] border-primary/20 ring-1 ring-primary/10'
          }`}>
            <StepBadge number={2} done={hasAgents} />
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="text-sm font-medium">Connect an agent</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose the fastest option to get started.
                </p>
              </div>

              {!hasAgents && (
                <div className="space-y-2">
                  {/* Option A: Cloud agent (fastest) */}
                  <button
                    onClick={() => setViewMode('connect')}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border bg-background hover:bg-accent transition-colors text-left group"
                  >
                    <div className="flex size-8 items-center justify-center rounded-md bg-blue-500/10 shrink-0">
                      <Cloud className="size-4 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">Cloud Agent</p>
                      <p className="text-[11px] text-muted-foreground">Paste an API key — ready in 30 seconds</p>
                    </div>
                    <span className="rounded-full bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 shrink-0">
                      Fastest
                    </span>
                    <ChevronRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
                  </button>

                  {/* Option B: Local agent */}
                  <button
                    onClick={() => setViewMode('connect')}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border bg-background hover:bg-accent transition-colors text-left group"
                  >
                    <div className="flex size-8 items-center justify-center rounded-md bg-purple-500/10 shrink-0">
                      <Terminal className="size-4 text-purple-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">Local Agent</p>
                      <p className="text-[11px] text-muted-foreground">Install the launcher, then connect Claude Code, Codex, etc.</p>
                    </div>
                    <ChevronRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Step 3: Start chatting */}
          <div className={`flex items-start gap-3 rounded-lg border bg-card p-4 ${
            !hasOnlineAgent ? 'opacity-50' : ''
          }`}>
            <StepBadge number={3} done={false} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Start chatting</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Once your agent is online, send a message to start collaborating.
              </p>
            </div>
          </div>
        </div>

        {/* Token hint */}
        {token && (
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">Workspace Token</p>
                <p className="text-[11px] text-muted-foreground">
                  Use this token to connect agents from the command line.
                </p>
              </div>
              <button
                onClick={() => copyToClipboard(token)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-background text-xs font-medium hover:bg-accent transition-colors shrink-0"
              >
                {isCopied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {isCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
