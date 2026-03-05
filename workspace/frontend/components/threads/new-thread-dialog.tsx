'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Crown } from 'lucide-react';
import type { WorkspaceAgent } from '@/lib/types';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  onCreateThread: (opts: { master: string; participants: string[] }) => void;
}

export function NewThreadDialog({ open, onOpenChange, agents, onCreateThread }: NewThreadDialogProps) {
  const agentNames = agents.map((a) => a.agentName);
  const defaultMaster = agents.find((a) => a.role === 'master')?.agentName || agents[0]?.agentName || '';

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [master, setMaster] = useState('');

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelected(new Set(agentNames));
      setMaster(defaultMaster);
    }
  }, [open]);

  const toggleAgent = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        // Can't deselect the master
        if (name === master) return prev;
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const setAsMaster = (name: string) => {
    setMaster(name);
    // Ensure master is selected
    setSelected((prev) => {
      if (prev.has(name)) return prev;
      return new Set([...prev, name]);
    });
  };

  const handleCreate = () => {
    const participants = agentNames.filter((n) => selected.has(n));
    onCreateThread({ master, participants });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>New Thread</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Select agents to include and choose a master agent.
        </DialogDescription>

        <div className="mt-3 space-y-1">
          {agents.map((agent) => {
            const color = getAgentColor(agent.agentName, agentNames);
            const isSelected = selected.has(agent.agentName);
            const isMaster = agent.agentName === master;
            const isOnline = agent.status === 'online';

            return (
              <div
                key={agent.agentName}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                  isSelected
                    ? 'bg-zinc-100 dark:bg-zinc-800'
                    : 'opacity-50 hover:opacity-75'
                )}
                onClick={() => toggleAgent(agent.agentName)}
              >
                {/* Avatar */}
                <div className={cn(
                  'size-8 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-bold',
                  color.initials
                )}>
                  {getAgentInitials(agent.agentName)}
                </div>

                {/* Name + status */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{agent.agentName}</span>
                    {!isOnline && (
                      <span className="text-[10px] text-muted-foreground">offline</span>
                    )}
                  </div>
                </div>

                {/* Master badge / set-as-master button */}
                {isSelected && (
                  isMaster ? (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-semibold shrink-0">
                      <Crown className="size-3" />
                      master
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAsMaster(agent.agentName); }}
                      className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
                    >
                      set master
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={selected.size === 0}>
            Create Thread
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
