'use client';

import { X, Copy, Check } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

interface AgentClient {
  id: string;
  name: string;
  description: string;
  command: string;
  color: string;
}

export function ConnectAgentView() {
  const { setViewMode } = useLayout();
  const { workspace } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const wsId = workspace?.workspaceId || 'WORKSPACE_ID';

  const agentClients: AgentClient[] = [
    { id: 'claude', name: 'Claude', description: "Anthropic's Claude Code CLI", command: `openagents connect claude --workspace ${wsId}`, color: 'bg-amber-500' },
    { id: 'openclaw', name: 'OpenClaw', description: 'Open-source agent client', command: `openagents connect openclaw --workspace ${wsId}`, color: 'bg-violet-500' },
    { id: 'codex', name: 'Codex', description: 'OpenAI Codex CLI agent', command: `openagents connect codex --workspace ${wsId}`, color: 'bg-emerald-500' },
    { id: 'gemini', name: 'Gemini', description: 'Google Gemini CLI agent', command: `openagents connect gemini --workspace ${wsId}`, color: 'bg-blue-500' },
    { id: 'kimi', name: 'Kimi', description: 'Moonshot Kimi agent client', command: `openagents connect kimi --workspace ${wsId}`, color: 'bg-rose-500' },
    { id: 'a2a', name: 'Custom (A2A)', description: 'Any A2A-compatible agent', command: `curl -X POST https://workspace.openagents.org/${wsId}/.well-known/agent.json`, color: 'bg-zinc-600' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold">Connect an Agent</h2>
          <span className="text-xs text-muted-foreground">Choose a client and run the command to join this workspace</span>
        </div>
        <button
          onClick={() => setViewMode('threads')}
          className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
          title="Back to threads"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
          {agentClients.map((client) => (
            <div
              key={client.id}
              className="rounded-lg bg-background border overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
            >
              {/* Card header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className={`size-9 rounded-lg ${client.color} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {client.name[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{client.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{client.description}</p>
                </div>
              </div>

              {/* Command block */}
              <div className="px-4 pb-3.5">
                <div className="relative group">
                  <pre className="bg-zinc-900 text-zinc-100 rounded-md px-3 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
                    <code>{client.command}</code>
                  </pre>
                  <button
                    className="absolute top-1.5 right-1.5 size-7 flex items-center justify-center rounded-md bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Copy command"
                    onClick={() => copyToClipboard(client.command)}
                  >
                    {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
