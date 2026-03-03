'use client';

import { useState, useEffect } from 'react';
import {
  Plus, MessageSquare, FileText, PlusSquare, UserPlus,
  Settings, HelpCircle, Copy, Check, Clock, CheckCircle, XCircle,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useLayout, type ViewMode } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { getAgentColor, getAgentInitials, timeAgo } from '@/lib/helpers';
import { cn } from '@/lib/utils';
import { workspaceApi } from '@/lib/api';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { toast } from 'sonner';
import type { WorkspaceInvitation } from '@/lib/types';

// ── Navigation button helper ──

function NavButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 h-8 rounded-lg text-[13px] transition-colors',
        active
          ? 'bg-zinc-100 dark:bg-zinc-800 text-primary font-medium'
          : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-foreground font-normal hover:text-primary'
      )}
    >
      <span className={active ? 'opacity-100' : 'opacity-60'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

// ── Main SidebarContent ──

export function SidebarContent() {
  const { isSidebarOpen, sidebarToggle, viewMode, setViewMode, setSelectedAgentName } = useLayout();
  const { agents, sessions, createSession, workspace, refreshWorkspace } = useWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const onlineCount = agents.filter((a) => a.status === 'online').length;
  const agentNames = agents.map((a) => a.agentName);

  // ── Collapsed sidebar ──
  if (!isSidebarOpen) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex justify-center px-2.5 py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { createSession(); setViewMode('threads'); }}
                className="size-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New Thread</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 flex flex-col items-center py-3 gap-2">
          {agents.map((agent) => {
            const color = getAgentColor(agent.agentName, agentNames);
            return (
              <Tooltip key={agent.agentName}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSelectedAgentName(agent.agentName)}
                    className={cn(
                      'size-7 rounded-full flex items-center justify-center text-white text-[9px] font-bold relative cursor-pointer hover:ring-2 hover:ring-zinc-300 dark:hover:ring-zinc-600 transition-shadow',
                      color.initials
                    )}
                  >
                    {getAgentInitials(agent.agentName)}
                    <span className={cn(
                      'absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-[1.5px] border-background',
                      agent.status === 'online' ? 'bg-green-500' : 'bg-zinc-300 dark:bg-zinc-600'
                    )} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{agent.agentName}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="px-2.5 py-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={sidebarToggle} className="w-full flex items-center justify-center py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <Settings className="size-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  // ── Expanded sidebar ──
  return (
    <>
      <ScrollArea className="shrink-0 w-full flex-1 h-[calc(100vh-5rem)]">
        <div className="flex flex-col min-h-full">
          {/* New Thread button */}
          <div className="px-3.5 pb-3">
            <button
              onClick={() => { createSession(); setViewMode('threads'); }}
              className="w-full h-9 flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-4" />
              <span>New Thread</span>
            </button>
          </div>

          {/* Agents */}
          <div className="flex-1 px-2.5">
            <p className="text-xs font-normal text-muted-foreground px-2 py-1.5 mb-0.5">
              Agents ({onlineCount}/{agents.length})
            </p>
            <div className="space-y-0.5">
              {agents.map((agent) => {
                const color = getAgentColor(agent.agentName, agentNames);
                return (
                  <button
                    key={agent.agentName}
                    onClick={() => setSelectedAgentName(agent.agentName)}
                    className="w-full flex items-center gap-2 px-2 h-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer group transition-colors"
                  >
                    <div className={cn(
                      'size-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0 relative',
                      color.initials
                    )}>
                      {getAgentInitials(agent.agentName)}
                      {agent.status === 'online' && (
                        <span className="absolute -end-0.5 -bottom-0.5 size-2 rounded-full border-[1.5px] border-background bg-green-500" />
                      )}
                    </div>
                    <span className="text-[13px] font-normal text-foreground group-hover:text-primary truncate text-left">
                      {agent.agentName}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Navigation */}
            <p className="text-xs font-normal text-muted-foreground px-2 py-1.5 mb-0.5 mt-6">
              Navigation
            </p>
            <div className="space-y-0.5">
              <NavButton active={viewMode === 'threads'} icon={<MessageSquare className="size-[15px]" />} label="Threads" count={sessions.length} onClick={() => setViewMode('threads')} />
              <NavButton active={viewMode === 'files'} icon={<FileText className="size-[15px]" />} label="Files" count={0} onClick={() => setViewMode('files')} />
            </div>

            {/* Actions */}
            <p className="text-xs font-normal text-muted-foreground px-2 py-1.5 mb-0.5 mt-6">
              Actions
            </p>
            <div className="space-y-0.5">
              <NavButton active={viewMode === 'connect'} icon={<PlusSquare className="size-[15px]" />} label="Connect Agent" onClick={() => setViewMode('connect')} />
              <NavButton icon={<UserPlus className="size-[15px]" />} label="Invite" onClick={() => setInviteOpen(true)} />
              <NavButton icon={<Settings className="size-[15px]" />} label="Settings" onClick={() => setSettingsOpen(true)} />
            </div>
          </div>

          {/* Bottom section */}
          <div className="px-2.5 py-3 space-y-0.5 mt-auto">
            <NavButton icon={<HelpCircle className="size-[15px]" />} label="Support" />
            <NavButton icon={<Settings className="size-[15px]" />} label="Collapse" onClick={sidebarToggle} />
          </div>
        </div>
      </ScrollArea>

      {/* Settings Dialog */}
      <SettingsDialogPortal open={settingsOpen} onOpenChange={setSettingsOpen} workspace={workspace} refreshWorkspace={refreshWorkspace} />

      {/* Invitation Dialog */}
      <InvitationDialogPortal open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}

// ── Controlled Settings Dialog ──

function SettingsDialogPortal({ open, onOpenChange, workspace, refreshWorkspace }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspace: ReturnType<typeof useWorkspace>['workspace'];
  refreshWorkspace: () => Promise<void>;
}) {
  const [name, setName] = useState(workspace?.name || '');
  const [saving, setSaving] = useState(false);
  const { isCopied: urlCopied, copyToClipboard: copyUrl } = useCopyToClipboard();
  const { isCopied: tokenCopied, copyToClipboard: copyToken } = useCopyToClipboard();

  useEffect(() => { if (open && workspace) setName(workspace.name); }, [open, workspace]);

  if (!workspace) return null;

  const workspaceUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${workspace.workspaceId}${window.location.search}`
    : '';

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.updateWorkspace({ name: name.trim() });
      await refreshWorkspace();
      toast.success('Settings saved');
      onOpenChange(false);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Workspace Settings</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Workspace Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Workspace" />
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace URL</Label>
            <div className="flex items-center gap-2">
              <Input value={workspaceUrl} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => copyUrl(workspaceUrl)}>
                {urlCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace ID</Label>
            <div className="flex items-center gap-2">
              <Input value={workspace.workspaceId} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => copyToken(workspace.workspaceId)}>
                {tokenCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Controlled Invitation Dialog ──

function InvitationDialogPortal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [agentName, setAgentName] = useState('');
  const [creating, setCreating] = useState(false);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const { copyToClipboard } = useCopyToClipboard();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const loadInvitations = async () => {
    try { const list = await workspaceApi.listInvitations(); setInvitations(list); } catch { /* */ }
  };

  useEffect(() => { if (open) loadInvitations(); }, [open]);

  const handleCreate = async () => {
    if (!agentName.trim()) return;
    setCreating(true);
    try {
      await workspaceApi.createInvitation(agentName.trim());
      toast.success(`Invitation sent to ${agentName.trim()}`);
      setAgentName('');
      loadInvitations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create invitation');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyToken = (token: string) => {
    copyToClipboard(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="size-3.5 text-amber-500" />;
      case 'accepted': return <CheckCircle className="size-3.5 text-green-500" />;
      case 'rejected': return <XCircle className="size-3.5 text-red-500" />;
      case 'expired': return <Clock className="size-3.5 text-zinc-400" />;
      default: return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Invite Agent</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Agent Name</Label>
            <div className="flex items-center gap-2">
              <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. claude-abc123" onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }} />
              <Button onClick={handleCreate} disabled={creating || !agentName.trim()}>{creating ? 'Inviting...' : 'Invite'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">The agent must be registered on the platform.</p>
          </div>
          {invitations.length > 0 && (
            <div className="space-y-2">
              <Label variant="secondary">Invitations</Label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {invitations.map((inv) => (
                  <div key={inv.invitationId} className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30">
                    {statusIcon(inv.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{inv.targetAgentName}</p>
                      <p className="text-xs text-muted-foreground">{inv.status} {inv.createdAt && `· ${timeAgo(inv.createdAt)}`}</p>
                    </div>
                    {inv.status === 'pending' && (
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => handleCopyToken(inv.inviteToken)} title="Copy invite token">
                        {copiedToken === inv.inviteToken ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
