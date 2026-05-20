export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'unknown'

export interface ParsedLog {
  raw: string
  timestamp: string | null
  /** Best-effort ISO if we recognized a timestamp. */
  iso: string | null
  level: LogLevel
  /** Source agent or component, if extractable. */
  source: string | null
  message: string
  /** Inlined JSON detected at the tail of the line (or full body, if any). */
  json: unknown | null
}

const LEVEL_RE = /\b(INFO|WARN|WARNING|ERROR|ERR|DEBUG|DBG|TRACE|TRC|FATAL|CRIT|CRITICAL)\b/i
const ISO_RE = /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+\-]\d{2}:?\d{2})?)/
const TIME_RE = /^\[?(\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\]?\s+/

function levelFrom(token: string | undefined): LogLevel {
  if (!token) return 'unknown'
  const t = token.toUpperCase()
  if (t === 'WARNING') return 'warn'
  if (t === 'ERR') return 'error'
  if (t === 'DBG') return 'debug'
  if (t === 'TRC') return 'trace'
  if (['FATAL', 'CRIT', 'CRITICAL'].includes(t)) return 'error'
  return (t.toLowerCase() as LogLevel) || 'unknown'
}

/**
 * Try to extract trailing JSON `{...}` or `[...]` if it parses cleanly.
 * Falls back to null. Cheap heuristic; we don't try to repair invalid JSON.
 */
function extractJSON(text: string): { json: unknown | null; rest: string } {
  const trimmed = text.trim()
  if (!trimmed) return { json: null, rest: text }
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '{' && last === '}') || (first === '[' && last === ']')) {
    try {
      return { json: JSON.parse(trimmed), rest: '' }
    } catch {
      // not valid — fall through
    }
  }
  // Heuristic: find rightmost { matched by trailing }
  const lastOpen = text.lastIndexOf('{')
  if (lastOpen > 0 && text.trim().endsWith('}')) {
    const candidate = text.slice(lastOpen).trim()
    try {
      const parsed = JSON.parse(candidate)
      return { json: parsed, rest: text.slice(0, lastOpen).trim() }
    } catch {}
  }
  return { json: null, rest: text }
}

export function parseLine(raw: string): ParsedLog {
  const out: ParsedLog = {
    raw,
    timestamp: null,
    iso: null,
    level: 'unknown',
    source: null,
    message: raw,
    json: null,
  }
  if (!raw.trim()) return out

  // ISO timestamp anywhere
  let working = raw
  const isoMatch = raw.match(ISO_RE)
  if (isoMatch) {
    out.timestamp = isoMatch[1]
    const parsed = Date.parse(isoMatch[1])
    if (!Number.isNaN(parsed)) out.iso = new Date(parsed).toISOString()
    working = working.replace(isoMatch[0], '').trim()
  } else {
    // Bare HH:MM:SS prefix
    const tm = raw.match(TIME_RE)
    if (tm) {
      out.timestamp = tm[1]
      working = raw.replace(TIME_RE, '')
    }
  }

  // Level
  const levelMatch = working.match(LEVEL_RE)
  if (levelMatch) {
    out.level = levelFrom(levelMatch[1])
    working = working.replace(levelMatch[0], '').replace(/^[\s\-:|>\[\]]+/, '')
  }

  // Source: leading bracket [name] or `name -` prefix
  const bracket = working.match(/^\[([^\]]{1,40})\]\s+/)
  if (bracket) {
    out.source = bracket[1]
    working = working.slice(bracket[0].length)
  } else {
    const named = working.match(/^([a-zA-Z0-9_-]{2,40}):\s+/)
    if (named) {
      out.source = named[1]
      working = working.slice(named[0].length)
    }
  }

  const { json, rest } = extractJSON(working.trim())
  if (json !== null) {
    out.json = json
    out.message = rest || ''
  } else {
    out.message = working.trim()
  }
  return out
}

export function parseLines(lines: string[]): ParsedLog[] {
  const out: ParsedLog[] = []
  for (const l of lines) out.push(parseLine(l))
  return out
}
