import type { RefObject } from 'react'
import { Ban, CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SmokeConsoleValue } from './SmokeConsoleValue'
import {
  collapseConsoleRepeats,
  consoleSeverity,
  parseConsoleValue,
  stampConsoleTime,
  type SmokeConsoleLine,
} from './smokeConsole'

interface SmokeConsoleMessagesProps {
  lines: SmokeConsoleLine[]
  scrollerRef: RefObject<HTMLDivElement | null>
}

function SeverityIcon({ line }: { line: SmokeConsoleLine }) {
  if (line.kind === 'input') {
    return (
      <span className="select-none font-semibold text-primary" aria-hidden>
        ›
      </span>
    )
  }
  if (line.kind === 'result') {
    return (
      <span
        className={cn(
          'select-none',
          line.ok === false ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden
      >
        ←
      </span>
    )
  }

  const severity = consoleSeverity(line)
  if (severity === 'error') {
    return <CircleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden />
  }
  if (severity === 'warning') {
    return <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-hidden />
  }
  if (severity === 'verbose') {
    return <Ban className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden />
  }
  return <Info className="h-3.5 w-3.5 text-primary/80" aria-hidden />
}

/**
 * DevTools console message list — severity tint, icon gutter, repeat badge, object tree.
 */
export function SmokeConsoleMessages({ lines, scrollerRef }: SmokeConsoleMessagesProps) {
  const rows = collapseConsoleRepeats(lines)

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 flex-1 overflow-y-auto font-mono text-[12px] leading-[18px]"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {rows.length === 0 ? null : (
        <ol>
          {rows.map(({ line, count }) => {
            const severity = consoleSeverity(line)
            const showTree = line.kind === 'result' && line.ok !== false
            return (
              <li
                key={line.id}
                className={cn(
                  'group flex gap-1.5 border-b border-transparent px-2 py-[2px]',
                  line.kind === 'input' && 'bg-muted/15',
                  severity === 'error' &&
                    line.kind === 'log' &&
                    'bg-destructive/10 text-destructive',
                  severity === 'warning' && 'bg-warning/10 text-warning',
                  line.kind === 'result' &&
                    line.ok === false &&
                    'bg-destructive/10 text-destructive',
                )}
              >
                <span className="mt-px flex w-4 shrink-0 justify-center">
                  <SeverityIcon line={line} />
                </span>

                {count > 1 && (
                  <span
                    className="mt-px h-[16px] min-w-[16px] shrink-0 rounded-full bg-muted px-1 text-center text-[10px] font-semibold leading-[16px] text-muted-foreground"
                    title={`${count} repeats`}
                  >
                    {count}
                  </span>
                )}

                <div className="min-w-0 flex-1 break-words">
                  {showTree ? (
                    <SmokeConsoleValue value={parseConsoleValue(line.text)} />
                  ) : (
                    <pre
                      className={cn(
                        'whitespace-pre-wrap break-words',
                        line.kind === 'input' && 'text-foreground',
                        line.kind === 'result' && line.ok === false && 'text-destructive',
                        severity === 'verbose' && 'text-muted-foreground',
                      )}
                    >
                      {line.text}
                    </pre>
                  )}
                </div>

                <span className="shrink-0 self-start pt-px text-[10px] text-muted-foreground opacity-0 tabular-nums transition-opacity group-hover:opacity-100">
                  {stampConsoleTime(line.at)}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
