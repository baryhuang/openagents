'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Paperclip, ChevronRight, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAgentColor } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { memo, useMemo, useState, type ReactNode } from 'react';

// Stable plugin arrays — avoids re-creating on every render
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

interface MarkdownContentProps {
  content: string;
  agentNames: string[];
}

/**
 * Matches `/v1/files/<uuid-ish>` URLs (with or without an http(s) scheme
 * and host). Group 1 captures the file id so the link renderer can fish
 * it out without re-parsing. Mirrors the Swift
 * `MarkdownSegmenter.fileLinkRegex` shape.
 */
const FILE_LINK_RE = /\/v1\/files\/([A-Za-z0-9][A-Za-z0-9\-_]+)(?:[/?#].*)?$/;

/** Inline file chip — tappable, opens the file in the right Content panel. */
function FileChip({ fileId, label }: { fileId: string; label?: string }) {
  const { setSelectedFileId } = useWorkspace();
  const { setRightPanelOpen, setRightPanelTab, isMobile, setViewMode } = useLayout();
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedFileId(fileId);
        if (isMobile) {
          setViewMode('files');
        } else {
          setRightPanelOpen(true);
          setRightPanelTab('content');
        }
      }}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-medium transition-colors max-w-full"
      title={label ? `Open ${label}` : 'Open file'}
    >
      <Paperclip className="size-3 text-muted-foreground shrink-0" />
      <span className="truncate">{label || 'View file'}</span>
      <ChevronRight className="size-3 text-muted-foreground opacity-50 shrink-0" />
    </button>
  );
}

/**
 * Sandboxed `<iframe>` for ` ```html ` fenced blocks emitted by agents.
 * Mirrors Swift's `HTMLBlockView`. Includes a "fullscreen" button that
 * pops a take-over modal so long demos have real space.
 */
function HtmlBlock({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  const wrapped = useMemo(
    () => wrapHtmlInDocument(html),
    [html],
  );
  return (
    <>
      <div className="my-2 rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-zinc-50 dark:bg-zinc-900/40">
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-zinc-200 dark:border-zinc-700">
          <span className="text-[10px] font-mono text-muted-foreground">html</span>
          <div className="flex-1" />
          <button
            onClick={() => setOpen(true)}
            className="size-5 flex items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground hover:text-foreground transition-colors"
            title="Open in fullscreen"
            aria-label="Open HTML in fullscreen"
          >
            <Maximize2 className="size-3" />
          </button>
        </div>
        <iframe
          srcDoc={wrapped}
          // `sandbox` strips JS by default + blocks navigation. allow-same-origin
          // is needed for measured-height tricks but we omit it on purpose — keeps
          // agent-emitted HTML from reading cookies / making same-origin requests.
          sandbox=""
          className="w-full h-[400px] block border-0 bg-white"
          title="Inline HTML preview"
        />
      </div>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex flex-col" onClick={() => setOpen(false)}>
          <div className="flex items-center justify-between px-4 py-2 bg-background border-b" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm font-semibold">Inline HTML</span>
            <button
              onClick={() => setOpen(false)}
              className="text-sm text-muted-foreground hover:text-foreground px-3 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
          <iframe
            srcDoc={wrapped}
            sandbox=""
            className="flex-1 w-full bg-white border-0"
            title="Fullscreen HTML preview"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function wrapHtmlInDocument(rawHtml: string): string {
  // Same shape as Swift's WebView.wrappedDocument — UTF-8 + viewport so
  // the iframe content is mobile-friendly; locks down scripts via CSP so
  // agent HTML can't escape the sandbox even if the browser somehow
  // grants script-src.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src * data:; img-src * data:; style-src * 'unsafe-inline'; script-src 'none'"><style>html,body{margin:0;padding:0;}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;}img,video,iframe{max-width:100%;height:auto;}</style></head><body>${rawHtml}</body></html>`;
}

/** Walk React children and colorize @agentname tokens in text nodes. */
function renderMentions(children: ReactNode, agentNames: string[]): ReactNode {
  if (!children || agentNames.length === 0) return children;

  const escaped = agentNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mentionRegex = new RegExp(`(@(?:${escaped.join('|')}))(?![\\w-])`, 'g');

  const processNode = (node: ReactNode): ReactNode => {
    if (typeof node === 'string') {
      const parts = node.split(mentionRegex);
      if (parts.length === 1) return node;
      return parts.map((part, i) => {
        if (part.startsWith('@') && agentNames.includes(part.slice(1))) {
          const color = getAgentColor(part.slice(1), agentNames);
          return (
            <span key={i} className={cn('font-medium rounded px-0.5', color.text)}>
              {part}
            </span>
          );
        }
        return part;
      });
    }
    if (Array.isArray(node)) {
      return node.map((child, i) => <span key={i}>{processNode(child)}</span>);
    }
    return node;
  };

  if (Array.isArray(children)) {
    return children.map((child, i) => <span key={i}>{processNode(child)}</span>);
  }
  return processNode(children);
}

export const MarkdownContent = memo(function MarkdownContent({ content, agentNames }: MarkdownContentProps) {
  const components: Components = useMemo(() => ({
    // Block elements
    h1: ({ children }) => (
      <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-base font-bold mt-3 mb-1.5 first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="font-semibold text-[15px] mt-3 mb-1 first:mt-0">{children}</h3>
    ),
    p: ({ children }) => (
      <p className="leading-relaxed mb-2 last:mb-0">{renderMentions(children, agentNames)}</p>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 my-2 text-muted-foreground italic">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-zinc-200 dark:border-zinc-700" />,

    // Lists
    ul: ({ children }) => (
      <ul className="my-2 ml-4 space-y-0.5 list-disc">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 ml-4 space-y-0.5 list-decimal">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed">{renderMentions(children, agentNames)}</li>
    ),

    // Tables
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-700">
        <table className="min-w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-zinc-50 dark:bg-zinc-800/50">{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b border-zinc-200 dark:border-zinc-700 last:border-0">
        {children}
      </tr>
    ),
    th: ({ children }) => (
      <th className="px-3 py-1.5 text-left font-semibold text-xs text-muted-foreground">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5">{renderMentions(children, agentNames)}</td>
    ),

    // Code — fenced ```html blocks become a sandboxed iframe (mirrors
    // Swift's HTMLBlockView); everything else stays as a code block with
    // syntax highlighting from rehype-highlight.
    code: ({ className, children, ...props }) => {
      const isBlock = className?.startsWith('language-') || className?.startsWith('hljs');
      if (isBlock && className?.startsWith('language-html')) {
        const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
        return <HtmlBlock html={raw} />;
      }
      if (isBlock) {
        return (
          <code className={cn('text-[13px]', className)} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className="text-[13px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">
          {children}
        </code>
      );
    },
    pre: ({ children }) => {
      // If react-markdown wrapped our html-iframe in <pre>, unwrap so the
      // iframe renders block-level instead of inside a code container.
      // Detected by checking for a single HtmlBlock React child.
      if (
        Array.isArray(children)
          ? children.length === 1 && (children[0] as { type?: unknown })?.type === HtmlBlock
          : (children as { type?: unknown })?.type === HtmlBlock
      ) {
        return <>{children}</>;
      }
      return (
        <pre className="my-2 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 overflow-x-auto text-[13px] leading-relaxed font-mono">
          {children}
        </pre>
      );
    },

    // Links — `/v1/files/<id>` URLs become tappable chips that open the
    // file in the Content panel (mirrors Swift's FileChipView via
    // MarkdownSegmenter.fileChip).
    a: ({ href, children }) => {
      if (href) {
        const fileMatch = href.match(FILE_LINK_RE);
        if (fileMatch) {
          const fileId = fileMatch[1];
          const label = typeof children === 'string'
            ? children
            : Array.isArray(children) && typeof children[0] === 'string'
              ? (children[0] as string)
              : undefined;
          // Use the link text as label only when it's not literally the
          // URL itself — that just looks like a stutter on the chip.
          const cleanLabel = label && label !== href ? label : undefined;
          return <FileChip fileId={fileId} label={cleanLabel} />;
        }
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {children}
        </a>
      );
    },

    // Inline
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [agentNames.join(',')]);

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
