import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LabConsoleValueProps {
  value: unknown
  name?: string
  depth?: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function preview(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (value === undefined) {
    return 'undefined'
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      return '{}'
    }
    return `{…}`
  }
  return String(value)
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-muted-foreground">null</span>
  }
  if (typeof value === 'undefined') {
    return <span className="text-muted-foreground">undefined</span>
  }
  if (typeof value === 'string') {
    return <span className="text-success">{JSON.stringify(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="text-primary">{value}</span>
  }
  if (typeof value === 'boolean') {
    return <span className="text-primary">{String(value)}</span>
  }
  return <span>{String(value)}</span>
}

/**
 * Chrome DevTools-style expandable object / array inspector for console results.
 */
export function LabConsoleValue({ value, name, depth = 0 }: LabConsoleValueProps) {
  const expandable = Array.isArray(value) || isPlainObject(value)
  const [open, setOpen] = useState(depth < 1 && expandable)

  if (!expandable) {
    return (
      <span className="inline-flex min-w-0 flex-wrap gap-1">
        {name != null && (
          <span className="text-primary/90">
            {name}
            <span className="text-muted-foreground">: </span>
          </span>
        )}
        <Scalar value={value} />
      </span>
    )
  }

  const entries: Array<{ key: string; child: unknown }> = Array.isArray(value)
    ? value.map((child, index) => ({ key: String(index), child }))
    : Object.keys(value as Record<string, unknown>).map((key) => ({
        key,
        child: (value as Record<string, unknown>)[key],
      }))

  let summary: ReactNode
  if (Array.isArray(value)) {
    summary = (
      <span className="text-muted-foreground">
        {name != null ? (
          <>
            <span className="text-primary/90">{name}</span>
            <span>: </span>
          </>
        ) : null}
        ({value.length}) [{value.slice(0, 3).map((item) => preview(item)).join(', ')}
        {value.length > 3 ? ', …' : ''}]
      </span>
    )
  } else {
    const keys = Object.keys(value as Record<string, unknown>)
    summary = (
      <span className="text-muted-foreground">
        {name != null ? (
          <>
            <span className="text-primary/90">{name}</span>
            <span>: </span>
          </>
        ) : null}
        {'{'}
        {keys
          .slice(0, 3)
          .map((key) => `${key}: ${preview((value as Record<string, unknown>)[key])}`)
          .join(', ')}
        {keys.length > 3 ? ', …' : ''}
        {'}'}
      </span>
    )
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        className="inline-flex max-w-full items-start gap-0.5 text-left hover:bg-muted/40"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <ChevronRight
          className={cn(
            'mt-[2px] h-3 w-3 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="min-w-0 break-words">{summary}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/80 pl-2">
          {entries.length === 0 ? (
            <span className="text-muted-foreground">{Array.isArray(value) ? '[]' : '{}'}</span>
          ) : (
            entries.map(({ key, child }) => (
              <div key={key} className="py-px">
                <LabConsoleValue value={child} name={key} depth={depth + 1} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
