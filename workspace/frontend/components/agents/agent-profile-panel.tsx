'use client';

import { X, Copy, Check, MessageSquare, Settings, Globe, Folder, Monitor, UserRoundCog } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { cn } from '@/lib/utils';

export function AgentProfilePanel() {
  const { selectedAgentName, setSelectedAgentName, isMobile } = useLayout();
  const { agents } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const agent = agents.find((a) => a.agentName === selectedAgentName);
  if (!agent) return null;

  const agentNames = agents.map((a) => a.agentName);
  const color = getAgentColor(agent.agentName, agentNames);
  const isOnline = agent.status === 'online';

  const infoItems = [
    { icon: <Monitor className="size-3.5" />, label: 'Type', value: agent.agentName.split('-')[0] || 'agent' },
    { icon: <Globe className="size-3.5" />, label: 'Server', value: 'openagents.org' },
    { icon: <Folder className="size-3.5" />, label: 'Folder', value: `/agents/${agent.agentName}` },
    { icon: <UserRoundCog className="size-3.5" />, label: 'Agent ID', value: `openagents:${agent.agentName}`, copyable: true },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/10 z-10"
        onClick={() => setSelectedAgentName(null)}
      />

      {/* Panel — full-width on mobile, 320px sidebar on desktop */}
      <div className={cn(
        'absolute top-0 right-0 bottom-0 bg-background border-l shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200',
        isMobile ? 'left-0 w-full' : 'w-[320px]'
      )}>
        {/* Close button */}
        <div className="flex items-center justify-end px-3 pt-3">
          <button
            onClick={() => setSelectedAgentName(null)}
            className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Profile header */}
        <div className="px-5 pb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'size-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 relative',
              color.initials
            )}>
              {getAgentInitials(agent.agentName)}
              <span className={cn(
                'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background',
                isOnline ? 'bg-green-500' : 'bg-zinc-300'
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold leading-tight truncate">{agent.agentName}</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={cn(
                  'inline-flex items-center gap-1 text-[11px] px-1.5 py-px rounded font-medium',
                  isOnline ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                )}>
                  <span className={cn('size-1.5 rounded-full', isOnline ? 'bg-green-500' : 'bg-zinc-400')} />
                  {agent.status}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Details card */}
        <div className="flex-1 overflow-y-auto px-3.5">
          <div className="rounded-lg border overflow-hidden">
            <div className="px-3.5 py-2.5 border-b">
              <span className="text-xs font-medium">Connection Details</span>
            </div>
            <div className="divide-y">
              {infoItems.map((item) => (
                <div key={item.label} className="flex items-start gap-3 px-3.5 py-3">
                  <div className="flex items-center gap-1.5 shrink-0 w-[80px] pt-px">
                    <span className="text-muted-foreground">{item.icon}</span>
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                  </div>
                  <div className="flex-1 min-w-0 flex items-start gap-1">
                    <span className={cn(
                      'text-[13px] break-all leading-snug',
                      item.label !== 'Type' ? 'font-mono' : 'font-medium capitalize'
                    )}>
                      {item.value}
                    </span>
                    {item.copyable && (
                      <button
                        className="size-6 shrink-0 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors mt-px"
                        title={`Copy ${item.label}`}
                        onClick={() => copyToClipboard(item.value)}
                      >
                        {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-3.5 py-3 border-t">
          <div className="flex gap-2">
            <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border bg-background hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              <MessageSquare className="size-3" />
              Message
            </button>
            <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border bg-background hover:bg-zinc-50 dark:hover:bg-zinc-800 text-muted-foreground transition-colors">
              <Settings className="size-3" />
              Configure
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
