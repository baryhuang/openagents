'use client';

// iMessage-style channel members sheet. Mirrors Swift's `MembersSheet`
// (ChatView.swift). Triggered by tapping the AvatarStack in the chat
// toolbar.

import { useState } from 'react';
import { Plus, Star } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { useWorkspace } from '@/lib/workspace-context';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
}

export function MembersSheet({ open, onOpenChange, sessionId }: Props) {
  const { sessions, agents, addParticipant, removeParticipant } = useWorkspace();
  const session = sessions.find((s) => s.sessionId === sessionId);
  const [searchText, setSearchText] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  if (!session) return null;

  const participants = session.participants ?? [];
  const isRoutine = session.sessionId.startsWith('routines:');

  const members = agents.filter((a) => participants.includes(a.agentName));
  const onlineCandidates = agents.filter(
    (a) => a.status === 'online' && !participants.includes(a.agentName),
  );
  const q = searchText.trim().toLowerCase();
  const addable = q
    ? onlineCandidates.filter((a) => a.agentName.toLowerCase().includes(q))
    : onlineCandidates;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle className="text-base">Channel Members</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {isRoutine ? (
            <RoutineLocked members={members} master={session.master ?? null} />
          ) : (
            <>
              <section className="space-y-2">
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground">
                  IN THIS CHANNEL ({members.length})
                </p>
                {members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No agents yet.</p>
                ) : (
                  <div className="space-y-1">
                    {members.map((agent) => {
                      const isMaster = session.master === agent.agentName;
                      return (
                        <div
                          key={agent.agentName}
                          className="flex items-center gap-2.5 py-1.5"
                        >
                          <AgentAvatar name={agent.agentName} size={28} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{agent.agentName}</p>
                            {isMaster && (
                              <p className="text-[10px] text-muted-foreground">
                                master
                              </p>
                            )}
                          </div>
                          {members.length > 1 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                              onClick={() => setPendingRemove(agent.agentName)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground">
                  ADD AGENTS
                </p>
                <Input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search online agents"
                />
                {addable.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    {searchText ? 'No matches.' : 'No online agents available.'}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {addable.map((agent) => (
                      <div
                        key={agent.agentName}
                        className="flex items-center gap-2.5 py-1.5"
                      >
                        <AgentAvatar
                          name={agent.agentName}
                          size={28}
                          status={agent.status}
                          showStatus
                        />
                        <span className="flex-1 text-sm truncate">{agent.agentName}</span>
                        <Button
                          size="sm"
                          onClick={() => addParticipant(sessionId, agent.agentName)}
                        >
                          <Plus className="size-3 mr-1" /> Add
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Remove-confirm prompt */}
        {pendingRemove && (
          <div className="border-t px-5 py-3 flex items-center justify-between gap-3 bg-muted/40">
            <p className="text-sm">
              Remove <strong>{pendingRemove}</strong>?{' '}
              <span className="text-muted-foreground">
                They will stop receiving messages on this channel.
              </span>
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPendingRemove(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  removeParticipant(sessionId, pendingRemove);
                  setPendingRemove(null);
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RoutineLocked({
  members,
  master,
}: {
  members: { agentName: string }[];
  master: string | null;
}) {
  return (
    <section className="space-y-2">
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground">
        OWNER
      </p>
      {members.map((agent) => (
        <div key={agent.agentName} className="flex items-center gap-2.5">
          <AgentAvatar name={agent.agentName} size={28} />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{agent.agentName}</p>
            {master === agent.agentName && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Star className="size-2.5 fill-amber-400 text-amber-400" />
                master
              </p>
            )}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground mt-3">
        This channel is a routine queue — membership is managed by the system.
      </p>
    </section>
  );
}
