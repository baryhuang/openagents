'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  FileText,
  Globe,
  Cloud,
  CheckSquare,
  Timer,
  Repeat,
  MessageSquare,
  Lock,
  ChevronDown,
  ChevronUp,
  Users,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WorkspaceAgent, SkillCatalogEntry } from '@/lib/types';

// ---------------------------------------------------------------------------
// Icon + color mapping
// ---------------------------------------------------------------------------

const SKILL_THEME: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  'workspace-core': { icon: MessageSquare, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  files:            { icon: FileText,      color: 'text-amber-500', bg: 'bg-amber-500/10' },
  browser:          { icon: Globe,         color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  tunnel:           { icon: Cloud,         color: 'text-sky-500', bg: 'bg-sky-500/10' },
  todos:            { icon: CheckSquare,   color: 'text-violet-500', bg: 'bg-violet-500/10' },
  timers:           { icon: Timer,         color: 'text-orange-500', bg: 'bg-orange-500/10' },
  routines:         { icon: Repeat,        color: 'text-pink-500', bg: 'bg-pink-500/10' },
};

const CATEGORY_LABELS: Record<string, string> = {
  core: 'Core',
  collaboration: 'Collaboration',
  productivity: 'Productivity',
  integration: 'Integrations',
};

const CATEGORY_ORDER = ['core', 'collaboration', 'productivity', 'integration'];

function groupByCategory(catalog: SkillCatalogEntry[]) {
  const groups: Record<string, SkillCatalogEntry[]> = {};
  for (const entry of catalog) {
    const cat = entry.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(entry);
  }
  return CATEGORY_ORDER
    .filter((c) => groups[c]?.length)
    .map((c) => ({ category: c, label: CATEGORY_LABELS[c] || c, skills: groups[c] }));
}

function getAgentSkillState(agent: WorkspaceAgent, skillId: string, defaultEnabled: boolean): boolean {
  if (agent.enabledSkills && agent.enabledSkills[skillId] !== undefined) {
    return agent.enabledSkills[skillId];
  }
  return defaultEnabled;
}

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

interface SkillCardProps {
  skill: SkillCatalogEntry;
  agents: WorkspaceAgent[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleAgent: (agentName: string, skillId: string, enabled: boolean) => void;
  savingAgent: string | null;
}

function SkillCard({ skill, agents, isExpanded, onToggleExpand, onToggleAgent, savingAgent }: SkillCardProps) {
  const theme = SKILL_THEME[skill.id] || { icon: Sparkles, color: 'text-muted-foreground', bg: 'bg-muted' };
  const Icon = theme.icon;

  const enabledAgents = agents.filter((a) => getAgentSkillState(a, skill.id, skill.default_enabled));
  const enabledCount = skill.toggleable ? enabledAgents.length : agents.length;

  return (
    <div className={cn(
      'rounded-xl border border-border bg-card overflow-hidden transition-all duration-200',
      isExpanded && 'ring-1 ring-primary/20',
    )}>
      {/* Card header — clickable */}
      <button
        className="w-full text-left px-4 pt-4 pb-3 focus:outline-none group"
        onClick={onToggleExpand}
      >
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={cn('size-10 rounded-lg flex items-center justify-center shrink-0', theme.bg)}>
            <Icon className={cn('size-5', theme.color)} />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold leading-tight">{skill.name}</h3>
              {!skill.toggleable && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                  <Lock className="size-2.5" />
                  Always on
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {skill.description}
            </p>
          </div>

          {/* Expand chevron */}
          {skill.toggleable && (
            <div className="shrink-0 mt-1 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors">
              {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </div>
          )}
        </div>

        {/* Agent usage strip */}
        <div className="flex items-center gap-2 mt-3 ml-[52px]">
          {enabledAgents.length > 0 ? (
            <>
              <div className="flex -space-x-1.5">
                {enabledAgents.slice(0, 5).map((a) => (
                  <AgentAvatar key={a.agentName} name={a.agentName} size={18} className="ring-2 ring-card" />
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {enabledCount} {enabledCount === 1 ? 'agent' : 'agents'}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
              <Users className="size-3" />
              No agents
            </span>
          )}
        </div>
      </button>

      {/* Expanded detail: per-agent toggles */}
      {isExpanded && skill.toggleable && (
        <div className="border-t border-border">
          <div className="px-4 py-2 bg-muted/20">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Manage per agent
            </span>
          </div>
          <div className="divide-y divide-border">
            {agents.map((agent) => {
              const enabled = getAgentSkillState(agent, skill.id, skill.default_enabled);
              const isSaving = savingAgent === agent.agentName;

              return (
                <div key={agent.agentName} className="flex items-center gap-3 px-4 py-2.5">
                  <AgentAvatar name={agent.agentName} size={22} status={agent.status} showStatus />
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium truncate block">{agent.agentName}</span>
                    {agent.agentType && (
                      <span className="text-[10px] text-muted-foreground capitalize">{agent.agentType}</span>
                    )}
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => onToggleAgent(agent.agentName, skill.id, checked)}
                    disabled={isSaving}
                    className="scale-[0.85]"
                  />
                </div>
              );
            })}
            {agents.length === 0 && (
              <div className="px-4 py-4 text-center text-xs text-muted-foreground">
                No agents connected to this workspace
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SkillsView
// ---------------------------------------------------------------------------

export function SkillsView() {
  const { agents, refreshWorkspace } = useWorkspace();
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [savingAgent, setSavingAgent] = useState<string | null>(null);

  useEffect(() => {
    workspaceApi.getSkillCatalog().then(setCatalog).catch(() => {});
  }, []);

  const handleToggleAgent = useCallback(
    async (agentName: string, skillId: string, enabled: boolean) => {
      const agent = agents.find((a) => a.agentName === agentName);
      if (!agent) return;

      const defaults: Record<string, boolean> = {};
      for (const s of catalog) {
        if (s.toggleable) defaults[s.id] = s.default_enabled;
      }

      const current = agent.enabledSkills || {};
      const merged = { ...defaults, ...current, [skillId]: enabled };

      setSavingAgent(agentName);
      try {
        await workspaceApi.updateMember(agentName, { enabled_skills: merged });
        await refreshWorkspace();
        const skillName = catalog.find((s) => s.id === skillId)?.name || skillId;
        toast.success(`${skillName} ${enabled ? 'enabled' : 'disabled'} for ${agentName}`);
      } catch {
        toast.error('Failed to update skill');
      } finally {
        setSavingAgent(null);
      }
    },
    [agents, catalog, refreshWorkspace],
  );

  const groups = groupByCategory(catalog);
  const toggleableCount = catalog.filter((s) => s.toggleable).length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Skill Hub</h2>
          {toggleableCount > 0 && (
            <span className="text-xs text-muted-foreground">{catalog.length} available</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {catalog.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Sparkles className="size-8 opacity-30" />
            <p className="text-sm">Loading skills...</p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {groups.map(({ category, label, skills }) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                  </h3>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                  {skills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      agents={agents}
                      isExpanded={expandedSkill === skill.id}
                      onToggleExpand={() =>
                        setExpandedSkill(expandedSkill === skill.id ? null : skill.id)
                      }
                      onToggleAgent={handleToggleAgent}
                      savingAgent={savingAgent}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
