'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Search,
  ExternalLink,
  Brain,
  Link,
  Plug,
  Wand2,
  Cpu,
  Layout,
  Triangle,
  Hexagon,
  Flame,
  Paintbrush,
  Palette,
  Eye,
  Zap,
  Server,
  FlaskConical,
  Share2,
  ArrowLeftRight,
  Route,
  Loader,
  Mail,
  Activity,
  Shield,
  Database,
  Leaf,
  Layers,
  Box,
  GitBranch,
  Terminal,
  Cloud,
  Bug,
  BarChart2,
  CheckCircle,
  Monitor,
  MonitorCheck,
  Split,
  ShieldAlert,
  Table,
  BookOpen,
  Ticket,
  CircleDot,
  CreditCard,
  Phone,
  Send,
  ShoppingBag,
  FileText,
  ShoppingCart,
  LayoutGrid,
  Workflow,
  LineChart,
  Table2,
  Presentation,
  File,
  PenTool,
  type LucideIcon,
} from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { SkillCatalogEntry } from '@/lib/types';

// ---------------------------------------------------------------------------
// Icon registry
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  brain: Brain,
  sparkles: Sparkles,
  link: Link,
  plug: Plug,
  'wand-2': Wand2,
  cpu: Cpu,
  layout: Layout,
  triangle: Triangle,
  hexagon: Hexagon,
  flame: Flame,
  paintbrush: Paintbrush,
  palette: Palette,
  eye: Eye,
  zap: Zap,
  server: Server,
  'flask-conical': FlaskConical,
  'share-2': Share2,
  'arrow-left-right': ArrowLeftRight,
  route: Route,
  loader: Loader,
  mail: Mail,
  activity: Activity,
  shield: Shield,
  database: Database,
  leaf: Leaf,
  layers: Layers,
  box: Box,
  'git-branch': GitBranch,
  terminal: Terminal,
  cloud: Cloud,
  bug: Bug,
  'bar-chart-2': BarChart2,
  'check-circle': CheckCircle,
  monitor: Monitor,
  'monitor-check': MonitorCheck,
  split: Split,
  'shield-alert': ShieldAlert,
  table: Table,
  'book-open': BookOpen,
  ticket: Ticket,
  'circle-dot': CircleDot,
  'credit-card': CreditCard,
  phone: Phone,
  send: Send,
  'shopping-bag': ShoppingBag,
  'file-text': FileText,
  'shopping-cart': ShoppingCart,
  'layout-grid': LayoutGrid,
  workflow: Workflow,
  'line-chart': LineChart,
  'table-2': Table2,
  presentation: Presentation,
  file: File,
  'pen-tool': PenTool,
};

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'ai-ml', label: 'AI & ML' },
  { id: 'frontend', label: 'Frontend' },
  { id: 'backend', label: 'Backend' },
  { id: 'database', label: 'Database' },
  { id: 'devops', label: 'DevOps' },
  { id: 'testing', label: 'Testing' },
  { id: 'security', label: 'Security' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'documents', label: 'Documents' },
];

const CATEGORY_COLORS: Record<string, string> = {
  'ai-ml': 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  frontend: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  backend: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  database: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  devops: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  testing: 'bg-green-500/10 text-green-600 dark:text-green-400',
  security: 'bg-red-500/10 text-red-600 dark:text-red-400',
  integrations: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  documents: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
};

const ICON_COLORS: Record<string, string> = {
  'ai-ml': 'text-violet-500',
  frontend: 'text-blue-500',
  backend: 'text-emerald-500',
  database: 'text-amber-500',
  devops: 'text-cyan-500',
  testing: 'text-green-500',
  security: 'text-red-500',
  integrations: 'text-pink-500',
  documents: 'text-orange-500',
};

const ICON_BG: Record<string, string> = {
  'ai-ml': 'bg-violet-500/10',
  frontend: 'bg-blue-500/10',
  backend: 'bg-emerald-500/10',
  database: 'bg-amber-500/10',
  devops: 'bg-cyan-500/10',
  testing: 'bg-green-500/10',
  security: 'bg-red-500/10',
  integrations: 'bg-pink-500/10',
  documents: 'bg-orange-500/10',
};

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

function SkillCard({
  skill,
  onSelect,
}: {
  skill: SkillCatalogEntry;
  onSelect: (skill: SkillCatalogEntry) => void;
}) {
  const Icon = ICON_MAP[skill.icon] || Sparkles;
  const iconColor = ICON_COLORS[skill.category] || 'text-muted-foreground';
  const iconBg = ICON_BG[skill.category] || 'bg-muted';

  return (
    <button
      className="text-left rounded-xl border border-border bg-card p-4 transition-all duration-150 hover:shadow-md hover:border-border/80 hover:-translate-y-0.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onSelect(skill)}
    >
      {/* Icon */}
      <div className={cn('size-10 rounded-lg flex items-center justify-center mb-3', iconBg)}>
        <Icon className={cn('size-5', iconColor)} />
      </div>

      {/* Name + Author */}
      <div className="flex items-center gap-2 mb-1.5">
        <h3 className="text-sm font-semibold leading-tight truncate">{skill.name}</h3>
        {skill.author === 'Anthropic' && (
          <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase tracking-wide">
            Official
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
        {skill.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/50">
        <span className={cn(
          'text-[10px] font-medium px-2 py-0.5 rounded-full',
          CATEGORY_COLORS[skill.category] || 'bg-muted text-muted-foreground',
        )}>
          {CATEGORIES.find(c => c.id === skill.category)?.label || skill.category}
        </span>
        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          View <ExternalLink className="size-2.5" />
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skill Detail Modal
// ---------------------------------------------------------------------------

function SkillDetail({
  skill,
  onClose,
}: {
  skill: SkillCatalogEntry;
  onClose: () => void;
}) {
  const Icon = ICON_MAP[skill.icon] || Sparkles;
  const iconColor = ICON_COLORS[skill.category] || 'text-muted-foreground';
  const iconBg = ICON_BG[skill.category] || 'bg-muted';
  const ghUrl = `https://github.com/${skill.source_repo}/tree/main/${skill.source_path}`;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      {/* Panel */}
      <div className="fixed inset-x-4 top-[10%] bottom-[10%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[520px] bg-background rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden border border-border">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-4">
            <div className={cn('size-14 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
              <Icon className={cn('size-7', iconColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold">{skill.name}</h2>
                {skill.author === 'Anthropic' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase tracking-wide">
                    Official
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{skill.description}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Category</div>
              <div className="text-sm font-medium">
                {CATEGORIES.find(c => c.id === skill.category)?.label || skill.category}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Author</div>
              <div className="text-sm font-medium">{skill.author}</div>
            </div>
          </div>

          {/* Source */}
          <div className="rounded-lg border border-border p-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Source</div>
            <a
              href={ghUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              {skill.source_repo}/{skill.source_path}
              <ExternalLink className="size-3" />
            </a>
          </div>

          {/* Install instructions */}
          <div className="rounded-lg border border-border p-4 bg-muted/30">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Install</div>
            <code className="text-xs font-mono block bg-background rounded-md p-3 border border-border select-all break-all">
              npx @anthropic-ai/skills install {skill.source_repo}/{skill.source_path}
            </code>
            <p className="text-[11px] text-muted-foreground mt-2">
              Or copy the SKILL.md file into your agent&apos;s <code className="text-[10px] bg-background px-1 py-0.5 rounded border">~/.claude/skills/{skill.id}/</code> directory.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Close
          </button>
          <a
            href={ghUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            View on GitHub
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main SkillsView
// ---------------------------------------------------------------------------

export function SkillsView() {
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedSkill, setSelectedSkill] = useState<SkillCatalogEntry | null>(null);

  useEffect(() => {
    workspaceApi.getSkillCatalog().then(setCatalog).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let result = catalog;
    if (activeCategory !== 'all') {
      result = result.filter(s => s.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
      );
    }
    return result;
  }, [catalog, search, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: catalog.length };
    for (const s of catalog) {
      counts[s.category] = (counts[s.category] || 0) + 1;
    }
    return counts;
  }, [catalog]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Skill Hub</h2>
            <span className="text-xs text-muted-foreground">{catalog.length} skills</span>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-muted/50 border border-input placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Category pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-none">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                activeCategory === cat.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {cat.label}
              {categoryCounts[cat.id] ? ` (${categoryCounts[cat.id]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {catalog.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Sparkles className="size-8 opacity-30" />
            <p className="text-sm">Loading skills...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Search className="size-8 opacity-30" />
            <p className="text-sm">No skills match your search</p>
            <button
              onClick={() => { setSearch(''); setActiveCategory('all'); }}
              className="text-xs text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {filtered.map(skill => (
                <SkillCard key={skill.id} skill={skill} onSelect={setSelectedSkill} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedSkill && (
        <SkillDetail skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
      )}
    </div>
  );
}
