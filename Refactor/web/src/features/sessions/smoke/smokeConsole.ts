import { ConsoleOutputKind, type SessionConsoleOutput } from '@/lib/speculum'

export type SmokeConsoleLineKind = 'log' | 'input' | 'result' | 'system'

export type ConsoleSeverity = 'verbose' | 'info' | 'warning' | 'error'

export interface SmokeConsoleLine {
  id: number
  at: number
  kind: SmokeConsoleLineKind
  /** Console log level when kind is `log` (0=log … 4=debug). */
  level?: number
  text: string
  ok?: boolean
}

/** Chrome-like default levels: Info + Warnings + Errors (Verbose off). */
export interface ConsoleLevelFilter {
  verbose: boolean
  info: boolean
  warning: boolean
  error: boolean
}

export const DEFAULT_CONSOLE_LEVELS: ConsoleLevelFilter = {
  verbose: false,
  info: true,
  warning: true,
  error: true,
}

const LEVEL_LABEL = ['log', 'warn', 'error', 'info', 'debug'] as const

export function consoleLevelLabel(level: number | undefined): string {
  if (level == null || level < 0 || level >= LEVEL_LABEL.length) {
    return 'log'
  }
  return LEVEL_LABEL[level]
}

export function consoleSeverity(line: SmokeConsoleLine): ConsoleSeverity {
  if (line.kind === 'result' && line.ok === false) {
    return 'error'
  }
  if (line.kind !== 'log') {
    return 'info'
  }
  switch (consoleLevelLabel(line.level)) {
    case 'error':
      return 'error'
    case 'warn':
      return 'warning'
    case 'debug':
      return 'verbose'
    default:
      return 'info'
  }
}

export function isDefaultConsoleLevels(levels: ConsoleLevelFilter): boolean {
  return (
    levels.verbose === DEFAULT_CONSOLE_LEVELS.verbose &&
    levels.info === DEFAULT_CONSOLE_LEVELS.info &&
    levels.warning === DEFAULT_CONSOLE_LEVELS.warning &&
    levels.error === DEFAULT_CONSOLE_LEVELS.error
  )
}

export function lineMatchesFilter(
  line: SmokeConsoleLine,
  levels: ConsoleLevelFilter,
  textFilter: string,
): boolean {
  if (line.kind === 'input' || line.kind === 'system') {
    // Always keep the REPL echo so the transcript reads like DevTools.
  } else if (!levels[consoleSeverity(line)]) {
    return false
  }

  const needle = textFilter.trim().toLowerCase()
  if (!needle) {
    return true
  }
  return line.text.toLowerCase().includes(needle)
}

/** Pretty-print eval results when the wire returns JSON. */
export function formatConsoleResult(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return text
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}

/** Parse wire text into a value suitable for a DevTools-style object tree. */
export function parseConsoleValue(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) {
    return text
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return text
  }
}

export function stampConsoleTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

export interface ConsoleMessageRow {
  line: SmokeConsoleLine
  /** Chrome-style repeat badge when identical log lines collapse. */
  count: number
}

/**
 * Collapse consecutive identical log lines (Chrome Console behavior).
 * Input / result / system lines never collapse.
 */
export function collapseConsoleRepeats(lines: SmokeConsoleLine[]): ConsoleMessageRow[] {
  const rows: ConsoleMessageRow[] = []
  for (const line of lines) {
    const previous = rows[rows.length - 1]
    if (
      previous &&
      line.kind === 'log' &&
      previous.line.kind === 'log' &&
      previous.line.level === line.level &&
      previous.line.text === line.text
    ) {
      previous.count += 1
      continue
    }
    rows.push({ line, count: 1 })
  }
  return rows
}

/** Maps a wire console envelope into a feed line (null = ignore / handled elsewhere). */
export function lineFromConsoleOutput(
  message: SessionConsoleOutput,
  id: number,
  at = Date.now(),
): SmokeConsoleLine | null {
  if (message.kind === ConsoleOutputKind.EvalResult) {
    const text = message.ok
      ? (message.value ?? '')
      : (message.error ?? 'evaluation failed')
    return {
      id,
      at,
      kind: 'result',
      text,
      ok: Boolean(message.ok),
    }
  }

  if (message.kind === ConsoleOutputKind.Console) {
    return {
      id,
      at,
      kind: 'log',
      level: message.level,
      text: message.text ?? '',
    }
  }

  return null
}

export function inputConsoleLine(id: number, code: string, at = Date.now()): SmokeConsoleLine {
  return { id, at, kind: 'input', text: code }
}
