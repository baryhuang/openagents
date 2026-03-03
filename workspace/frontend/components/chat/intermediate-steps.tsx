'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Brain,
  Wrench,
  Activity,
  Pencil,
  Eye,
  Terminal,
  Search,
  Send,
  Clock,
  Users,
  ChevronRight,
} from 'lucide-react';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';

// ── Content Parsing ──

interface ParsedStep {
  type: 'thinking' | 'tool_call' | 'status';
  tool?: string;
  toolDisplay?: string;
  args?: string;
  summary?: string;
  text?: string;
}

function parseStepContent(content: string): ParsedStep {
  // Thinking
  if (content === 'thinking...' || content.toLowerCase() === 'thinking') {
    return { type: 'thinking', text: content };
  }

  // Claude adapter: **Using tool:** `ToolName`\n```\n{args}\n```
  const toolMatch = content.match(
    /\*\*Using tool:\*\*\s*`([^`]+)`\s*```([\s\S]*?)```/
  );
  if (toolMatch) {
    const rawTool = toolMatch[1];
    const args = toolMatch[2].trim();
    const toolDisplay = cleanToolName(rawTool);
    const summary = extractToolSummary(toolDisplay, args);
    return { type: 'tool_call', tool: rawTool, toolDisplay, args, summary };
  }

  // Codex adapter: **Running:** `command`
  const runMatch = content.match(/\*\*Running:\*\*\s*`([^`]+)`/);
  if (runMatch) {
    return {
      type: 'tool_call',
      tool: 'Bash',
      toolDisplay: 'Bash',
      summary: runMatch[1],
    };
  }

  // Codex adapter: **Editing:** `filename`
  const editMatch = content.match(/\*\*Editing:\*\*\s*`([^`]+)`/);
  if (editMatch) {
    return {
      type: 'tool_call',
      tool: 'Edit',
      toolDisplay: 'Edit',
      summary: editMatch[1],
    };
  }

  // General status
  return { type: 'status', text: content };
}

function cleanToolName(name: string): string {
  // mcp__openagents-workspace__workspace_status → workspace_status
  const mcpMatch = name.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) return mcpMatch[1];
  // mcp_openagents-workspace__workspace_status
  const mcpMatch2 = name.match(/^mcp_[^_]+--.+?__(.+)$/);
  if (mcpMatch2) return mcpMatch2[1];
  return name;
}

function extractToolSummary(tool: string, args: string): string {
  const fileMatch = args.match(/'file_path':\s*'([^']+)'/);
  if (fileMatch && ['Write', 'Read', 'Edit'].includes(tool)) {
    return fileMatch[1];
  }

  const commandMatch = args.match(/'command':\s*'([^']+)'/);
  if (commandMatch && tool === 'Bash') {
    return commandMatch[1].slice(0, 80);
  }

  const statusMatch = args.match(/'status':\s*'([^']+)'/);
  if (statusMatch) return statusMatch[1];

  const contentMatch = args.match(/'content':\s*'([^']{0,60})/);
  if (contentMatch) {
    return contentMatch[1] + (contentMatch[1].length >= 60 ? '...' : '');
  }

  const patternMatch = args.match(/'pattern':\s*'([^']+)'/);
  if (patternMatch) return patternMatch[1];

  return args.length > 60 ? args.slice(0, 60) + '...' : args;
}

// ── Icon Mapping ──

const TOOL_ICONS: Record<string, typeof Wrench> = {
  Write: Pencil,
  Edit: Pencil,
  Read: Eye,
  Bash: Terminal,
  Glob: Search,
  Grep: Search,
  workspace_send_message: Send,
  workspace_status: Activity,
  workspace_get_history: Clock,
  workspace_get_agents: Users,
};

function getStepIcon(parsed: ParsedStep) {
  if (parsed.type === 'thinking') return Brain;
  if (parsed.type === 'status') return Activity;
  return TOOL_ICONS[parsed.toolDisplay || ''] || Wrench;
}

// ── Step Item ──

function StepItem({ message }: { message: WorkspaceMessage }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseStepContent(message.content);
  const Icon = getStepIcon(parsed);
  const hasDetail = parsed.type === 'tool_call' && !!parsed.args;

  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex items-center gap-2 text-xs py-0.5 w-full text-left rounded transition-colors',
          hasDetail
            ? 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 -ml-1 pl-1 pr-1'
            : 'cursor-default',
          'text-muted-foreground'
        )}
        onClick={() => hasDetail && setExpanded(!expanded)}
        disabled={!hasDetail}
      >
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            parsed.type === 'thinking' && 'text-amber-500 animate-pulse',
            parsed.type === 'tool_call' && 'text-blue-500',
            parsed.type === 'status' && 'text-emerald-500'
          )}
        />

        {parsed.type === 'thinking' && (
          <span className="italic animate-pulse">thinking...</span>
        )}

        {parsed.type === 'tool_call' && (
          <span className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="font-mono font-medium text-foreground/70 shrink-0">
              {parsed.toolDisplay}
            </span>
            {parsed.summary && (
              <>
                <span className="text-muted-foreground/30 shrink-0">›</span>
                <span className="truncate text-muted-foreground/60">
                  {parsed.summary}
                </span>
              </>
            )}
          </span>
        )}

        {parsed.type === 'status' && <span>{parsed.text}</span>}

        {hasDetail && (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform duration-200 text-muted-foreground/40',
              expanded && 'rotate-90'
            )}
          />
        )}
      </button>

      {expanded && parsed.args && (
        <pre className="text-[11px] leading-relaxed bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-md p-2.5 ml-[22px] mt-1 mb-1.5 overflow-x-auto max-h-48 text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all">
          {parsed.args}
        </pre>
      )}
    </div>
  );
}

// ── Intermediate Steps Group ──

interface IntermediateStepsProps {
  steps: WorkspaceMessage[];
  agents?: WorkspaceAgent[];
}

export function IntermediateSteps({ steps }: IntermediateStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className="flex items-start gap-3 py-1">
      {/* Spacer matching avatar width for alignment with chat messages */}
      <div className="size-8 shrink-0" />
      <div className="border-l-2 border-zinc-200 dark:border-zinc-700 pl-3 py-0.5 min-w-0 flex-1">
        {steps.map((step) => (
          <StepItem key={step.messageId} message={step} />
        ))}
      </div>
    </div>
  );
}
