'use client';

/**
 * Lightweight A2UI renderer for the web app. Mirrors the Swift
 * `A2UIRendererView` placement (inline below message content, capped
 * width) but uses a small built-in tree walker instead of pulling in a
 * full third-party JSON-to-UI engine.
 *
 * Handles the most common spec node types emitted by openagents agents:
 *   Stack / Heading / Text / Image / Icon / Button / ChoiceList /
 *   ConfirmDialog / Divider / Spacer / Card / Alert
 *
 * Unknown types render as a small placeholder chip so a sibling failed
 * node doesn't blank out the rest of the spec.
 *
 * Interactive components (Button, ChoiceList, ConfirmDialog) call
 * `onAction` with the agent-supplied `action.name` + optional `params`.
 * The caller is responsible for routing this back to the agent via
 * `workspace.tool_result` (see `chat-view.tsx`).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface A2UIAction {
  /** Agent-supplied action id; round-tripped verbatim. */
  id: string;
  /** Optional parameters captured from the interactive component. */
  value?: unknown;
}

interface RendererProps {
  spec: Record<string, unknown> | null | undefined;
  onAction?: (action: A2UIAction) => void;
  /** Recursion guard — prevents pathological deep specs from running away. */
  depth?: number;
  className?: string;
}

const MAX_DEPTH = 24;

export function A2UIRenderer({ spec, onAction, depth = 0, className }: RendererProps) {
  if (!spec || typeof spec !== 'object') return null;
  if (depth > MAX_DEPTH) return <Placeholder reason="depth limit reached" />;
  return (
    <div className={cn('a2ui-root w-full max-w-[420px]', className)}>
      <Node node={spec} onAction={onAction} depth={depth} />
    </div>
  );
}

function Node({ node, onAction, depth }: { node: unknown; onAction?: (a: A2UIAction) => void; depth: number }) {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const type = String(obj.type || '');
  const props = (obj.props as Record<string, unknown>) || {};
  const children = (obj.children as unknown[]) || [];

  switch (type) {
    case 'Stack':
      return <StackNode props={props} children={children} onAction={onAction} depth={depth} />;
    case 'Card':
      return <CardNode props={props} children={children} onAction={onAction} depth={depth} />;
    case 'Heading':
      return <HeadingNode props={props} />;
    case 'Text':
      return <TextNode props={props} />;
    case 'Image':
      return <ImageNode props={props} />;
    case 'Icon':
      return <IconNode props={props} />;
    case 'Button':
      return <ButtonNode props={props} onAction={onAction} />;
    case 'ChoiceList':
      return <ChoiceListNode props={props} onAction={onAction} />;
    case 'ConfirmDialog':
      return <ConfirmDialogNode props={props} onAction={onAction} />;
    case 'Alert':
      return <AlertNode props={props} />;
    case 'Divider':
      return <hr className="my-2 border-t border-input" />;
    case 'Spacer':
      return <div className="h-2" />;
    default:
      return <Placeholder reason={`unknown type \`${type || 'undefined'}\``} />;
  }
}

function Placeholder({ reason }: { reason: string }) {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-mono">
      <span>A2UI:</span>
      <span>{reason}</span>
    </div>
  );
}

// ── Layout / content ──

function StackNode({ props, children, onAction, depth }: { props: Record<string, unknown>; children: unknown[]; onAction?: (a: A2UIAction) => void; depth: number }) {
  const direction = props.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const spacing = numberOrDefault(props.spacing, 8);
  return (
    <div
      className={cn('flex', direction === 'vertical' ? 'flex-col' : 'flex-row items-center')}
      style={{ gap: `${spacing}px` }}
    >
      {children.map((child, i) => (
        <Node key={i} node={child} onAction={onAction} depth={depth + 1} />
      ))}
    </div>
  );
}

function CardNode({ props, children, onAction, depth }: { props: Record<string, unknown>; children: unknown[]; onAction?: (a: A2UIAction) => void; depth: number }) {
  const padding = numberOrDefault(props.padding, 12);
  const radius = numberOrDefault(props.cornerRadius, 12);
  const title = typeof props.title === 'string' ? props.title : undefined;
  return (
    <div
      className="bg-zinc-50 dark:bg-zinc-800/50 border border-input"
      style={{ padding: `${padding}px`, borderRadius: `${radius}px` }}
    >
      {title && <p className="text-sm font-semibold mb-2">{title}</p>}
      <div className="flex flex-col gap-2">
        {children.map((child, i) => (
          <Node key={i} node={child} onAction={onAction} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
}

function HeadingNode({ props }: { props: Record<string, unknown> }) {
  const text = String(props.text ?? '');
  const level = Math.min(4, Math.max(1, Number(props.level) || 2));
  const sizes = ['text-xl', 'text-lg', 'text-base', 'text-sm'];
  return <p className={cn('font-semibold', sizes[level - 1])}>{text}</p>;
}

function TextNode({ props }: { props: Record<string, unknown> }) {
  const content = String(props.content ?? '');
  const weight = props.weight === 'bold' ? 'font-bold' : props.weight === 'medium' ? 'font-medium' : '';
  const styleProp = props.style === 'caption' ? 'text-xs text-muted-foreground' : props.style === 'heading' ? 'text-base font-semibold' : 'text-sm';
  return <p className={cn(styleProp, weight)}>{content}</p>;
}

function ImageNode({ props }: { props: Record<string, unknown> }) {
  const url = typeof props.url === 'string' ? props.url : undefined;
  const width = numberOrDefault(props.width, undefined as number | undefined);
  const height = numberOrDefault(props.height, undefined as number | undefined);
  if (!url) return null;
  return (
    // Browser handles auth via cookies; no oafile: scheme needed (that
    // was a WKWebView limitation specific to the Swift app).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      style={{ width: width ? `${width}px` : undefined, height: height ? `${height}px` : undefined }}
      className="max-w-full rounded-md object-contain"
    />
  );
}

function IconNode({ props }: { props: Record<string, unknown> }) {
  const name = typeof props.name === 'string' ? props.name : '?';
  return <span className="inline-block text-xs text-muted-foreground font-mono">{name}</span>;
}

// ── Interactive ──

function ButtonNode({ props, onAction }: { props: Record<string, unknown>; onAction?: (a: A2UIAction) => void }) {
  const label = String(props.label ?? 'Button');
  const action = (props.action as Record<string, unknown>) || {};
  const actionName = typeof action.name === 'string' ? action.name : '';
  const style = props.style;
  const variant = style === 'destructive' ? 'destructive' : style === 'secondary' ? 'outline' : 'default';
  const disabled = !!props.disabled || !actionName;
  return (
    <Button
      size="sm"
      // @ts-expect-error project Button variant set includes these
      variant={variant}
      disabled={disabled}
      onClick={() => actionName && onAction?.({ id: actionName, value: action.params })}
    >
      {label}
    </Button>
  );
}

function ChoiceListNode({ props, onAction }: { props: Record<string, unknown>; onAction?: (a: A2UIAction) => void }) {
  const question = typeof props.question === 'string' ? props.question : undefined;
  const options = Array.isArray(props.options) ? (props.options as Array<Record<string, unknown>>) : [];
  const action = (props.action as Record<string, unknown>) || {};
  const actionName = typeof action.name === 'string' ? action.name : '';
  return (
    <div className="flex flex-col gap-2">
      {question && <p className="text-sm font-medium">{question}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((opt, i) => {
          const id = String(opt.id ?? i);
          const label = String(opt.label ?? id);
          return (
            <Button
              key={i}
              size="sm"
              variant="outline"
              disabled={!actionName}
              onClick={() => actionName && onAction?.({ id: actionName, value: { id } })}
            >
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmDialogNode({ props, onAction }: { props: Record<string, unknown>; onAction?: (a: A2UIAction) => void }) {
  const triggerLabel = String(props.triggerLabel ?? props.title ?? 'Confirm');
  const message = typeof props.message === 'string' ? props.message : undefined;
  const action = (props.action as Record<string, unknown>) || {};
  const actionName = typeof action.name === 'string' ? action.name : '';
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="destructive" disabled={!actionName} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <div className="bg-background rounded-lg p-4 max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            {message && <p className="text-sm">{message}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                {String(props.cancelLabel ?? 'Cancel')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setOpen(false);
                  if (actionName) onAction?.({ id: actionName, value: action.params });
                }}
              >
                {String(props.confirmLabel ?? 'Confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AlertNode({ props }: { props: Record<string, unknown> }) {
  const title = typeof props.title === 'string' ? props.title : undefined;
  const message = typeof props.message === 'string' ? props.message : '';
  const severity = props.severity as string | undefined;
  const tone =
    severity === 'error' ? 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200'
    : severity === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200'
    : severity === 'success' ? 'bg-green-50 border-green-200 text-green-900 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200'
    : 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200';
  return (
    <div className={cn('border rounded-md px-3 py-2 text-sm', tone)}>
      {title && <p className="font-semibold mb-0.5">{title}</p>}
      <p>{message}</p>
    </div>
  );
}

function numberOrDefault<T>(value: unknown, fallback: T): T | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}
