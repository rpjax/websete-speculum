import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { cn } from '@/lib/utils'
import { eventRoleLabel, eventTone } from '../model/eventSemantics'
import { formatClock, shortEventLabel } from './chapterSheetModel'
import { JournalSessionGroupRow } from './JournalSessionGroupRow'
import {
  buildMixedJournalStream,
  type JournalGroupingOptions,
  type JournalSortOrder,
  type JournalStreamItem,
} from './journalStreamModel'

interface JournalEventStreamProps {
  events: DiagnosticsEventRecord[]
  selectedId: string | null
  onSelect: (event: DiagnosticsEventRecord) => void
  onFilterSession?: (connectionId: string) => void
  grouping: JournalGroupingOptions
  sortOrder?: JournalSortOrder
  className?: string
  emptyHint?: {
    onWidenPeriod?: () => void
  }
}

function FactRow({
  event,
  runCount,
  selectedId,
  onSelect,
}: {
  event: DiagnosticsEventRecord
  runCount: number
  selectedId: string | null
  onSelect: (event: DiagnosticsEventRecord) => void
}) {
  const tone = eventTone(event)
  const active = selectedId === event.id
  return (
    <button
      type="button"
      data-event-id={event.id}
      aria-selected={active}
      title={event.name}
      onClick={() => onSelect(event)}
      className={cn(
        'flex w-full items-center gap-2 border-b border-border/20 px-2 py-1 text-left text-[12px] hover:bg-muted/35',
        active && 'bg-primary/12 ring-1 ring-inset ring-primary/35',
        tone === 'fault' && !active && 'bg-destructive/[0.07]',
      )}
    >
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          tone === 'fault'
            ? 'bg-destructive'
            : tone === 'warning'
              ? 'bg-amber-500'
              : tone === 'lifecycle'
                ? 'bg-sky-500'
                : tone === 'metric'
                  ? 'bg-muted-foreground/40'
                  : 'bg-emerald-500/80',
        )}
      />
      <span className="w-[4.75rem] shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatClock(Date.parse(event.utc))}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">
        {shortEventLabel(event.name)}
        {runCount > 1 ? (
          <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">×{runCount}</span>
        ) : null}
      </span>
      <span className="hidden w-16 shrink-0 truncate text-[10px] text-muted-foreground sm:block">{event.domain}</span>
      <span
        className={cn(
          'w-[5.5rem] shrink-0 truncate text-[10px]',
          tone === 'fault' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {eventRoleLabel(event)}
      </span>
    </button>
  )
}

function defaultExpandedKeys(items: JournalStreamItem[], selectedId: string | null): Set<string> {
  const keys = new Set<string>()
  const groups = items.filter((i): i is Extract<JournalStreamItem, { kind: 'group' }> => i.kind === 'group')
  if (groups.length === 0) return keys
  const withSelection = selectedId
    ? groups.find((g) => g.group.events.some((e) => e.id === selectedId))
    : null
  if (withSelection) keys.add(withSelection.group.key)
  const withFault = groups.find((g) => g.group.faultCount > 0)
  if (withFault) keys.add(withFault.group.key)
  keys.add(groups[0].group.key)
  return keys
}

export function JournalEventStream({
  events,
  selectedId,
  onSelect,
  onFilterSession,
  grouping,
  sortOrder = 'newest',
  className,
  emptyHint,
}: JournalEventStreamProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  const items = useMemo(
    () => buildMixedJournalStream(events, grouping, sortOrder),
    [events, grouping, sortOrder],
  )
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const seededFor = useRef<string>('')
  const didFocus = useRef(false)

  // Seed expansion only when the set of groups changes (not on every select/expand).
  useEffect(() => {
    const identity = `${grouping.groupSessionFacts}:${sortOrder}:${items
      .filter((i) => i.kind === 'group')
      .map((i) => i.group.key)
      .join('|')}`
    if (identity === seededFor.current) return
    seededFor.current = identity
    setExpanded(defaultExpandedKeys(items, selectedId))
  }, [items, grouping.groupSessionFacts, sortOrder]) // eslint-disable-line react-hooks/exhaustive-deps -- seed once per group set

  useEffect(() => {
    if (!selectedId) return
    const host = items.find(
      (i) => i.kind === 'group' && i.group.events.some((e) => e.id === selectedId),
    )
    if (!host || host.kind !== 'group') return
    setExpanded((prev) => {
      if (prev.has(host.group.key)) return prev
      const next = new Set(prev)
      next.add(host.group.key)
      return next
    })
  }, [selectedId, items])

  const navEvents = useMemo(() => {
    const out: DiagnosticsEventRecord[] = []
    for (const item of items) {
      if (item.kind === 'fact') out.push(item.event)
      else if (expanded.has(item.group.key)) {
        for (const row of item.group.listEvents) out.push(row.event)
      }
    }
    return out
  }, [items, expanded])

  useEffect(() => {
    if (didFocus.current || events.length === 0 || !listRef.current) return
    didFocus.current = true
    listRef.current.focus({ preventScroll: true })
  }, [events.length])

  // Keep selection visible only when the selected fact changes — never on expand/collapse.
  const prevSelectedRef = useRef<string | null>(null)
  const selectionScrolledRef = useRef(false)
  useLayoutEffect(() => {
    if (!selectedId || !listRef.current) return
    if (prevSelectedRef.current === selectedId) return
    prevSelectedRef.current = selectedId
    const el = listRef.current.querySelector(`[data-event-id="${CSS.escape(selectedId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
    scrollTopRef.current = listRef.current.scrollTop
    selectionScrolledRef.current = true
  }, [selectedId])

  // After expand/collapse or regroup, restore scroll so the viewport does not jump to top.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (selectionScrolledRef.current) {
      selectionScrolledRef.current = false
      return
    }
    el.scrollTop = scrollTopRef.current
  }, [expanded, items])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'j' && e.key !== 'k') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (navEvents.length === 0) return
      e.preventDefault()
      const idx = Math.max(0, navEvents.findIndex((ev) => ev.id === selectedId))
      const next =
        e.key === 'ArrowDown' || e.key === 'j'
          ? navEvents[Math.min(navEvents.length - 1, (selectedId ? idx : -1) + 1)]
          : navEvents[Math.max(0, (selectedId ? idx : navEvents.length) - 1)]
      if (next) onSelect(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navEvents, selectedId, onSelect])

  if (events.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-4 text-center',
          className,
        )}
      >
        <div>
          <p className="text-sm text-foreground">No facts to show</p>
          <p className="mt-1 max-w-sm text-[12px] text-muted-foreground">
            Widen the time range or clear search / filters.
          </p>
        </div>
        {emptyHint?.onWidenPeriod && (
          <button
            type="button"
            className="h-8 rounded-md border border-border px-3 text-[12px] text-foreground hover:bg-muted/40"
            onClick={emptyHint.onWidenPeriod}
          >
            Last 6 hours
          </button>
        )}
      </div>
    )
  }

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card', className)}
      aria-label="Journal facts"
    >
      <div className="sticky top-0 z-10 flex gap-2 border-b border-border/70 bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="w-2" />
        <span className="w-[4.75rem]">Time</span>
        <span className="min-w-0 flex-1">What happened</span>
        <span className="hidden w-16 sm:block">Domain</span>
        <span className="w-[5.5rem]">Kind</span>
      </div>
      <div
        ref={listRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none [scrollbar-width:thin]"
        onScroll={(e) => {
          scrollTopRef.current = e.currentTarget.scrollTop
        }}
      >
        {items.map((item) => {
          if (item.kind === 'group') {
            return (
              <JournalSessionGroupRow
                key={item.group.key}
                group={item.group}
                expanded={expanded.has(item.group.key)}
                onToggle={() => toggle(item.group.key)}
                selectedId={selectedId}
                onSelect={onSelect}
                onFilterSession={onFilterSession}
              />
            )
          }
          return (
            <FactRow
              key={`${item.event.id}:${item.event.seq ?? ''}`}
              event={item.event}
              runCount={item.runCount}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )
        })}
      </div>
      <p className="shrink-0 border-t border-border/40 px-2 py-1 text-[10px] text-muted-foreground">
        Chronological · groups use session start as date · ↑↓ or j/k · Esc clears
      </p>
    </section>
  )
}
