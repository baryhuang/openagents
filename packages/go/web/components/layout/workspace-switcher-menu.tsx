'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Clock,
  Link as LinkIcon,
  ArrowRight,
  Settings,
  Share2,
  KeyRound,
  Check,
  Copy,
  Crown,
  Shield,
  X,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import { Switch } from '@/components/ui/switch';
import { useWorkspace } from '@/lib/workspace-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useLayout } from './layout-context';
import {
  WorkspaceHistory,
  parseWorkspaceURL,
  type WorkspaceHistoryEntry,
} from '@/lib/workspace-history';
import { workspaceApi } from '@/lib/api';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { WorkspaceCollaborator } from '@/lib/types';

interface Props {
  trigger: React.ReactNode;
}

export function WorkspaceSwitcherMenu({ trigger }: Props) {
  const router = useRouter();
  const { workspace, token, refreshWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<WorkspaceHistoryEntry[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setEntries(WorkspaceHistory.entries());
      setUrlInput('');
      setUrlError(null);
    }
  }, [open]);

  const connectTo = (workspaceId: string, t: string) => {
    setOpen(false);
    router.push(`/${workspaceId}?token=${encodeURIComponent(t)}`);
  };

  const handleConnect = () => {
    setUrlError(null);
    const parsed = parseWorkspaceURL(urlInput);
    if (!parsed) {
      setUrlError(
        'Paste a workspace URL like https://agents.caremojo.app/<id>?token=…',
      );
      return;
    }
    connectTo(parsed.workspaceId, parsed.token);
  };

  const handleCopyToken = () => {
    if (!token) {
      toast.error('No workspace token available');
      return;
    }
    navigator.clipboard.writeText(token);
    setTokenCopied(true);
    toast.success('Workspace token copied');
    setTimeout(() => setTokenCopied(false), 1500);
  };

  // The current workspace is filtered out of "recent" so the user
  // doesn't see "switch to where you already are."
  const recents = entries.filter(
    (e) => e.workspaceId !== workspace?.slug,
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="w-[320px] p-0"
        >
          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-semibold tracking-wide text-muted-foreground mb-2 px-1">
              CONNECT TO A WORKSPACE
            </p>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5">
              <LinkIcon className="size-3.5 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setUrlError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConnect();
                }}
                placeholder="Paste workspace URL"
                className="flex-1 min-w-0 bg-transparent outline-none text-xs"
              />
              <button
                onClick={handleConnect}
                disabled={!urlInput.trim()}
                className="size-6 flex items-center justify-center rounded text-primary disabled:opacity-30 hover:bg-primary/10 shrink-0"
                aria-label="Connect"
              >
                <ArrowRight className="size-3.5" />
              </button>
            </div>
            {urlError && (
              <p className="mt-1.5 text-[11px] text-destructive px-1">{urlError}</p>
            )}
          </div>

          {recents.length > 0 && (
            <div className="p-2 border-b border-border max-h-[260px] overflow-y-auto">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground mb-1 px-2 mt-1">
                RECENT
              </p>
              {recents.map((entry) => (
                <button
                  key={entry.workspaceId}
                  onClick={() =>
                    connectTo(entry.workspaceId, entry.workspaceToken)
                  }
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left transition-colors"
                >
                  <Clock className="size-3 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {entry.name || entry.workspaceId}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate font-mono">
                      {entry.workspaceId}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="p-1">
            <MenuItem
              icon={<Settings className="size-3.5" />}
              label="Workspace settings"
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
            />
            <MenuItem
              icon={<Share2 className="size-3.5" />}
              label="Share workspace"
              onClick={() => {
                setOpen(false);
                setShareOpen(true);
              }}
            />
            {token && (
              <MenuItem
                icon={
                  tokenCopied ? (
                    <Check className="size-3.5" />
                  ) : (
                    <KeyRound className="size-3.5" />
                  )
                }
                label={tokenCopied ? 'Copied!' : 'Copy workspace token'}
                onClick={handleCopyToken}
              />
            )}
          </div>
        </PopoverContent>
      </Popover>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        refreshWorkspace={refreshWorkspace}
      />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left text-xs transition-colors"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─── Share Dialog (lifted out of the old sidebar-content) ────────────────

function ShareDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [collaborators, setCollaborators] = useState<WorkspaceCollaborator[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCollaborators = async () => {
    setLoading(true);
    try {
      const data = await workspaceApi.listCollaborators();
      setCollaborators(data.collaborators);
      setOwner(data.owner);
    } catch {
      // ignore — modal still shows the add form
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) loadCollaborators();
  }, [open]);

  const handleAdd = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) return;
    setAdding(true);
    try {
      await workspaceApi.addCollaborator(trimmed, 'editor');
      toast.success(`Shared with ${trimmed}`);
      setEmail('');
      loadCollaborators();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add collaborator');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (emailToRemove: string) => {
    try {
      await workspaceApi.removeCollaborator(emailToRemove);
      setCollaborators((prev) => prev.filter((c) => c.email !== emailToRemove));
      toast.success(`Removed ${emailToRemove}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Workspace</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-xs text-muted-foreground">
            Add people by email. They can access this workspace by signing in — no
            token needed.
          </p>

          <div className="space-y-2">
            <Label>Email address</Label>
            <div className="flex items-center gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
                className="flex-1"
              />
              <Button onClick={handleAdd} disabled={adding || !email.trim()}>
                {adding ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label variant="secondary">People with access</Label>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {owner && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30">
                  <Crown className="size-3.5 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{owner}</p>
                    <p className="text-xs text-muted-foreground">Owner</p>
                  </div>
                </div>
              )}
              {loading && collaborators.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">Loading…</p>
              )}
              {collaborators.map((c) => (
                <div
                  key={c.email}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.email}</p>
                    <p className="text-xs text-muted-foreground">Full access</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => handleRemove(c.email)}
                    title="Remove access"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              {!loading && !owner && collaborators.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">
                  No one has been added yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Settings Dialog (lifted out of the old sidebar-content) ──────────────

function SettingsDialog({
  open,
  onOpenChange,
  refreshWorkspace,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  refreshWorkspace: () => Promise<void>;
}) {
  const { workspace, notificationSound, setNotificationSound } = useWorkspace();
  const { user, isOpenAgentsDomain } = useOpenAgentsAuth();
  const [name, setName] = useState(workspace?.name || '');
  const [monitorMode, setMonitorMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const { isCopied: urlCopied, copyToClipboard: copyUrl } = useCopyToClipboard();
  const { isCopied: idCopied, copyToClipboard: copyId } = useCopyToClipboard();

  useEffect(() => {
    if (open && workspace) {
      setName(workspace.name);
      setMonitorMode(!!workspace.settings?.monitorMode);
    }
  }, [open, workspace]);

  if (!workspace) return null;

  const workspaceUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${workspace.slug}${window.location.search}`
      : '';

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.updateWorkspace({
        name: name.trim(),
        settings: { ...workspace.settings, monitorMode },
      });
      await refreshWorkspace();
      toast.success('Settings saved');
      onOpenChange(false);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const isUnclaimed = workspace && !workspace.creatorEmail;
  const isOwnedByUser = workspace && user && workspace.creatorEmail === user.email;

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await workspaceApi.claimWorkspace();
      await refreshWorkspace();
      toast.success('Workspace claimed successfully');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to claim workspace');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label>Workspace Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
            />
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace URL</Label>
            <div className="flex items-center gap-2">
              <Input
                value={workspaceUrl}
                readOnly
                className="text-xs font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyUrl(workspaceUrl)}
              >
                {urlCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace ID</Label>
            <div className="flex items-center gap-2">
              <Input value={workspace.slug} readOnly className="text-xs font-mono" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyId(workspace.slug)}
              >
                {idCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          {/* Claim affordance for OpenAgents-hosted users on unclaimed workspaces */}
          {isOpenAgentsDomain && user && isUnclaimed && (
            <Button
              onClick={handleClaim}
              disabled={claiming}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Shield className="size-3.5 mr-1.5" />
              {claiming ? 'Claiming…' : 'Claim Workspace'}
            </Button>
          )}
          {isOwnedByUser && (
            <p className="text-[11px] text-emerald-600 flex items-center gap-1">
              <Shield className="size-3" /> You own this workspace
            </p>
          )}

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>Monitor Mode</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  Experimental
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Show a 2x3 grid overview of recent chats instead of the chat list.
              </p>
            </div>
            <Switch checked={monitorMode} onCheckedChange={setMonitorMode} size="sm" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <Label>Notification Sound</Label>
              <p className="text-xs text-muted-foreground">
                Play a sound when an agent completes a task.
              </p>
            </div>
            <Switch
              checked={notificationSound}
              onCheckedChange={setNotificationSound}
              size="sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
