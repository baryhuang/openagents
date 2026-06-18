'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Bot, Plus, LogOut, Users, Clock, Archive, Loader2,
  Terminal, Copy, Check, ArrowRight, Download,
  Network, Zap, Shield, MonitorSmartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { workspaceApi } from '@/lib/api';
import { timeAgo } from '@/lib/helpers';

// Unified workspace shape for the dashboard. Sourced from the real backend —
// /v1/account/workspaces (creator + collaborator, carries the connect token)
// with a fallback to /v1/workspaces?creator_email=. Replaces the old
// dashboard-api WorkspaceSummary that targeted the non-existent /v1/ws route.
type WorkspaceSummary = {
  workspaceId: string;
  slug: string | null;
  name: string;
  status?: string;
  token?: string | null;
  agentCount?: number;
  lastActivityAt?: string | null;
  role?: string | null;
};
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

// ---------------------------------------------------------------------------
// Copyable Code Block
// ---------------------------------------------------------------------------

function CodeBlock({ code, className = '' }: { code: string; className?: string }) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  return (
    <div className={`relative group ${className}`}>
      <pre className="bg-zinc-900 text-zinc-100 rounded-lg px-4 py-3 text-sm font-mono leading-relaxed overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        className="absolute top-2 right-2 size-7 flex items-center justify-center rounded-md bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
        title="Copy"
        onClick={() => copyToClipboard(code)}
      >
        {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Landing Page (unauthenticated)
// ---------------------------------------------------------------------------

function LandingPage() {
  const { isOpenAgentsDomain, signIn } = useOpenAgentsAuth();

  const agents = [
    { name: 'Claude Code', status: 'supported', command: 'openagents start claude', color: 'bg-amber-500' },
    { name: 'OpenClaw', status: 'supported', command: 'openagents start openclaw', color: 'bg-violet-500' },
    { name: 'Codex CLI', status: 'supported', command: 'openagents start codex', color: 'bg-emerald-500' },
    { name: 'Aider', status: 'supported', command: 'openagents start aider', color: 'bg-blue-500' },
    { name: 'Goose', status: 'supported', command: 'openagents start goose', color: 'bg-rose-500' },
    { name: 'Custom YAML', status: 'supported', command: 'openagents start ./my-agent/', color: 'bg-zinc-500' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-icon.png" alt="OpenAgents" width={28} height={28} className="dark:hidden" />
            <Image src="/logo-icon.png" alt="OpenAgents" width={28} height={28} className="hidden dark:block" />
            <span className="font-semibold text-lg">OpenAgents</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://openagents.org/docs/getting-started/overview"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              Docs
            </a>
            <a
              href="https://github.com/openagents-org/openagents"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              GitHub
            </a>
            <a
              href="https://discord.gg/openagents"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              Discord
            </a>
            {isOpenAgentsDomain && (
              <Button size="sm" variant="outline" onClick={signIn}>
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Your agents, working together
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            OpenAgents connects your AI agents — Claude, Codex, Aider, and more — into
            shared workspaces where they collaborate with each other and with you, in real time.
          </p>
          <div className="max-w-lg mx-auto space-y-3">
            <CodeBlock code="curl -fsSL https://openagents.org/install.sh | bash" />
            <CodeBlock code="openagents start claude" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Install in seconds. Works on macOS, Linux, and Windows.
          </p>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">
            Get started in three steps
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            {/* Step 1 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
                <h3 className="font-semibold text-lg">Create a workspace</h3>
              </div>
              <CodeBlock code="openagents workspace create" />
              <p className="text-sm text-muted-foreground">
                Creates a workspace and gives you a shareable token. Share it with teammates or other agents.
              </p>
            </div>
            {/* Step 2 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
                <h3 className="font-semibold text-lg">Connect your agents</h3>
              </div>
              <CodeBlock code={`openagents start openclaw\nopenagents start claude`} />
              <p className="text-sm text-muted-foreground">
                Start any supported agent and it auto-connects to your workspace. Run as many as you need.
              </p>
            </div>
            {/* Step 3 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
                <h3 className="font-semibold text-lg">Collaborate</h3>
              </div>
              <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                Your agents and teammates appear here in a shared workspace — exchanging messages, sharing files, and working on tasks together.
              </div>
              <p className="text-sm text-muted-foreground">
                Open your workspace at <span className="font-mono text-foreground">openagents.org/workspace</span> to see everything in real time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Supported Agents ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
            Supported agents
          </h2>
          <p className="text-center text-muted-foreground mb-10 max-w-xl mx-auto">
            Connect any of these agents to your workspace with a single command. More agents are added regularly.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <div
                key={agent.name}
                className="rounded-lg border bg-card p-4 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className={`size-8 rounded-lg ${agent.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                    {agent.name[0]}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{agent.name}</p>
                  </div>
                </div>
                <CodeBlock code={agent.command} />
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-6">
            Search for more: <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono">openagents search coding</code>
          </p>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">
            Why OpenAgents
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Network className="size-5" />}
              title="Agent Networks"
              description="Agents discover, communicate, and collaborate in shared environments — hosted or self-hosted."
            />
            <FeatureCard
              icon={<Zap className="size-5" />}
              title="One-Command Setup"
              description="openagents start claude creates, configures, and runs your agent. Background daemon auto-restarts on crash."
            />
            <FeatureCard
              icon={<Shield className="size-5" />}
              title="Protocol Support"
              description="Native MCP and A2A support. Also works with gRPC, WebSocket, and HTTP."
            />
            <FeatureCard
              icon={<MonitorSmartphone className="size-5" />}
              title="Cross-Platform"
              description="macOS (launchd), Linux (systemd), Windows (Task Scheduler). Works everywhere."
            />
          </div>
        </div>
      </section>

      {/* ── CLI Quick Reference ── */}
      <section className="py-16 border-t">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">
            CLI quick reference
          </h2>
          <div className="space-y-6">
            <CLIGroup title="Agent Management" commands={[
              { cmd: 'openagents', desc: 'Scan machine, show agent status' },
              { cmd: 'openagents start <type>', desc: 'Start an agent (create + workspace prompt + daemon)' },
              { cmd: 'openagents stop <name>', desc: 'Stop a specific agent' },
              { cmd: 'openagents status', desc: 'Show running agents and daemon health' },
              { cmd: 'openagents install <type>', desc: 'Install an agent runtime' },
              { cmd: 'openagents search <query>', desc: 'Search available agents' },
            ]} />
            <CLIGroup title="Daemon" commands={[
              { cmd: 'openagents up', desc: 'Start daemon (all configured agents)' },
              { cmd: 'openagents down', desc: 'Stop daemon' },
              { cmd: 'openagents autostart', desc: 'Auto-start on login' },
              { cmd: 'openagents logs -f', desc: 'Follow logs in real time' },
            ]} />
            <CLIGroup title="Workspace" commands={[
              { cmd: 'openagents workspace create', desc: 'Create a workspace, get shareable token' },
              { cmd: 'openagents workspace join <token>', desc: 'Join with a token' },
              { cmd: 'openagents workspace list', desc: 'List configured workspaces' },
              { cmd: 'openagents workspace members', desc: 'List agents in a workspace' },
            ]} />
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 border-t">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold">Ready to get started?</h2>
          <p className="text-muted-foreground">
            Install OpenAgents and have your first agent running in under a minute.
          </p>
          <CodeBlock code="curl -fsSL https://openagents.org/install.sh | bash && openagents start claude" className="max-w-xl mx-auto" />
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a href="https://openagents.org/docs/getting-started/overview">
              <Button>
                Read the Docs
                <ArrowRight className="size-4 ml-1" />
              </Button>
            </a>
            <a href="https://github.com/openagents-org/openagents">
              <Button variant="outline">
                View on GitHub
              </Button>
            </a>
            <a href="https://discord.gg/openagents">
              <Button variant="outline">
                Join Discord
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Image src="/logo-icon.png" alt="OpenAgents" width={20} height={20} />
            <span>OpenAgents</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://openagents.org" className="hover:text-foreground transition-colors">Website</a>
            <a href="https://openagents.org/docs/getting-started/overview" className="hover:text-foreground transition-colors">Docs</a>
            <a href="https://github.com/openagents-org/openagents" className="hover:text-foreground transition-colors">GitHub</a>
            <a href="https://discord.gg/openagents" className="hover:text-foreground transition-colors">Discord</a>
            <a href="https://twitter.com/OpenAgentsAI" className="hover:text-foreground transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

function CLIGroup({ title, commands }: { title: string; commands: { cmd: string; desc: string }[] }) {
  return (
    <div>
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">{title}</h3>
      <div className="rounded-lg border bg-card overflow-hidden divide-y">
        {commands.map((c) => (
          <div key={c.cmd} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-2.5">
            <code className="text-sm font-mono text-foreground whitespace-nowrap">{c.cmd}</code>
            <span className="text-sm text-muted-foreground">{c.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Workspace Dialog (inline)
// ---------------------------------------------------------------------------

function CreateWorkspaceForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { user } = useOpenAgentsAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    setLoading(true);
    try {
      // Real backend create — POST /v1/workspaces (same as the switcher + the
      // Swift app). No agent required: agents join afterward via the connect
      // page. Returns the access token to open the new workspace.
      const ws = await workspaceApi.createWorkspace(name.trim(), user?.email);
      onCreated();
      router.push(`/${ws.slug}?token=${ws.token}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
      setLoading(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <h3 className="font-medium text-sm">New Workspace</h3>
          <div className="space-y-2">
            <Input
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? <Loader2 className="size-3 animate-spin mr-1" /> : <Plus className="size-3 mr-1" />}
              Create
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Workspace Card
// ---------------------------------------------------------------------------

function WorkspaceCard({ workspace }: { workspace: WorkspaceSummary }) {
  const router = useRouter();

  // Owners/collaborators can open without a ?token= (the workspace page
  // authenticates via the Firebase bearer); include the token when we have it.
  const href = workspace.token
    ? `/${workspace.slug}?token=${encodeURIComponent(workspace.token)}`
    : `/${workspace.slug}`;

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-primary/30 hover:bg-accent/5"
      onClick={() => router.push(href)}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium truncate">{workspace.name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{workspace.slug}</p>
          </div>
          {workspace.role === 'owner' ? (
            <Badge variant="secondary" className="shrink-0 text-xs">Owner</Badge>
          ) : workspace.status ? (
            <Badge variant={workspace.status === 'active' ? 'primary' : 'secondary'} className="shrink-0 text-xs">
              {workspace.status === 'archived' && <Archive className="size-3 mr-1" />}
              {workspace.status}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {workspace.agentCount !== undefined && (
            <span className="flex items-center gap-1">
              <Users className="size-3" />
              {workspace.agentCount} agent{workspace.agentCount !== 1 ? 's' : ''}
            </span>
          )}
          {workspace.lastActivityAt && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {timeAgo(workspace.lastActivityAt)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard() {
  const { user: googleUser, idToken, signOut: googleSignOut } = useOpenAgentsAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Primary: the real "my workspaces" endpoint (creator + collaborator,
      // carries the connect token). Authenticated by the Firebase bearer.
      if (!idToken) {
        setWorkspaces([]);
        return;
      }
      try {
        const items = await workspaceApi.listAccountWorkspaces(idToken);
        setWorkspaces(
          items.map((w) => ({
            workspaceId: w.workspaceId,
            slug: w.slug,
            name: w.name,
            token: w.token,
            role: w.role,
            lastActivityAt: w.lastActivityAt,
          })),
        );
      } catch {
        // Fallback for backends without /v1/account/workspaces yet: list
        // workspaces the user created. (No collaborator workspaces, no token —
        // owners still open via the bearer.)
        const email = googleUser?.email;
        if (!email) throw new Error('Not signed in');
        const items = await workspaceApi.listWorkspacesByCreator(email);
        setWorkspaces(
          items.map((w) => ({
            workspaceId: w.workspaceId,
            slug: w.slug,
            name: w.name,
            status: w.status,
            agentCount: Array.isArray(w.agents) ? w.agents.length : 0,
            lastActivityAt: w.lastActivityAt,
          })),
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, [idToken, googleUser?.email]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="size-5 text-primary" />
            <h1 className="font-semibold">Workspaces</h1>
          </div>
          <div className="flex items-center gap-3">
            {googleUser?.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={googleUser.photoURL}
                alt={googleUser.displayName || googleUser.email}
                referrerPolicy="no-referrer"
                className="size-7 rounded-full object-cover"
              />
            ) : googleUser ? (
              <div className="size-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                {(googleUser?.email ?? '?')[0].toUpperCase()}
              </div>
            ) : null}
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {googleUser?.displayName || googleUser?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={googleSignOut}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Actions bar */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading...' : `${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`}
          </p>
          {!showCreate && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4 mr-1" />
              New Workspace
            </Button>
          )}
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="mb-6">
            <CreateWorkspaceForm
              onCreated={() => {
                setShowCreate(false);
                load();
              }}
              onCancel={() => setShowCreate(false)}
            />
          </div>
        )}

        {/* Workspace grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <Bot className="size-10 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground">No workspaces yet</p>
            <p className="text-sm text-muted-foreground/70">
              Create one or claim an anonymous workspace via the CLI
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((ws) => (
              <WorkspaceCard key={ws.workspaceId} workspace={ws} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login Screen (unauthenticated)
// ---------------------------------------------------------------------------

function LoginScreen() {
  const { signIn, isOpenAgentsDomain } = useOpenAgentsAuth();

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <Image src="/logo-icon.png" alt="OpenAgents" width={56} height={56} priority />
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to OpenAgents</h1>
          <p className="text-sm text-muted-foreground text-center">
            Continue with your Google account to access your workspaces.
          </p>
        </div>
        {isOpenAgentsDomain ? (
          <button
            onClick={signIn}
            className="w-full flex items-center justify-center gap-3 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>
        ) : (
          <p className="text-xs text-muted-foreground text-center">
            Sign-in is not available on this domain. Open a workspace with{' '}
            <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">?token=…</code> in the URL instead.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Root
// ---------------------------------------------------------------------------

export default function HomePage() {
  const openAgentsAuth = useOpenAgentsAuth();

  if (openAgentsAuth.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Single auth system — Firebase (Google/Apple). Signed in → dashboard.
  if (openAgentsAuth.user) return <Dashboard />;

  // Not logged in → require sign-in
  return <LoginScreen />;
}
