'use client';

import { useState, useEffect } from 'react';
import { X, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import type { AgentCatalogEntry } from '@/lib/types';

// Colors assigned to agent cards based on index
const CARD_COLORS = [
  'bg-amber-500',
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-pink-500',
  'bg-lime-500',
];

function getCardColor(index: number): string {
  return CARD_COLORS[index % CARD_COLORS.length];
}

function getConnectCommand(agentName: string, workspaceId: string): string {
  return `openagents connect ${agentName} --workspace ${workspaceId}`;
}

export function ConnectAgentView() {
  const { setViewMode } = useLayout();
  const { workspace } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wsId = workspace?.workspaceId || 'WORKSPACE_ID';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    workspaceApi
      .getAgentCatalog()
      .then((entries) => {
        if (!cancelled) setCatalog(entries);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load catalog');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 lg:px-4 py-2 lg:py-3 border-b shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center gap-0.5 lg:gap-3 min-w-0">
          <h2 className="text-sm font-semibold">Connect an Agent</h2>
          <span className="text-xs text-muted-foreground hidden lg:inline">Choose a client and run the command to join this workspace</span>
        </div>
        <button
          onClick={() => setViewMode('threads')}
          className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
          title="Back to threads"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" />
            <span className="text-sm">Loading agent catalog...</span>
          </div>
        )}

        {error && (
          <div className="text-center py-16 text-sm text-muted-foreground">
            Failed to load catalog. Please try again.
          </div>
        )}

        {!loading && !error && (
          <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
            {catalog.map((entry, idx) => {
              const command = getConnectCommand(entry.name, wsId);
              return (
                <div
                  key={entry.name}
                  className="rounded-lg bg-background border overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
                >
                  {/* Card header */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className={`size-9 rounded-lg ${getCardColor(idx)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                      {entry.label[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold">{entry.label}</p>
                        {entry.homepage && (
                          <a
                            href={entry.homepage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                            title="Visit homepage"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{entry.description}</p>
                    </div>
                  </div>

                  {/* Command block */}
                  <div className="px-4 pb-3.5">
                    <div className="relative group">
                      <pre className="bg-zinc-900 text-zinc-100 rounded-md px-3 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
                        <code>{command}</code>
                      </pre>
                      <button
                        className="absolute top-1.5 right-1.5 size-7 flex items-center justify-center rounded-md bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                        title="Copy command"
                        onClick={() => copyToClipboard(command)}
                      >
                        {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
