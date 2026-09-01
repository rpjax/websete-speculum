import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useNarrativeQuery } from './hooks/useNarrativeQuery'
import { useNarrativeTail } from './hooks/useNarrativeTail'
import { useNarrativeSelection } from './hooks/useNarrativeSelection'
import { AttentionStrip } from './panels/AttentionStrip'
import { JournalEventStream } from './panels/JournalEventStream'
import { JournalFactDetail } from './panels/JournalFactDetail'
import { JournalToolbar } from './panels/JournalToolbar'
import { DEFAULT_JOURNAL_GROUPING, type JournalGroupingOptions, type JournalSortOrder } from './panels/journalStreamModel'
import { eventTone } from './model/eventSemantics'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

export default function NarrativeWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const connectionId = searchParams.get('connectionId') ?? searchParams.get('sessionId')
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const [grouping, setGrouping] = useState<JournalGroupingOptions>(DEFAULT_JOURNAL_GROUPING)
  const [sortOrder, setSortOrder] = useState<JournalSortOrder>('newest')

  const initialPeriod =
    fromParam && toParam && Number.isFinite(Date.parse(fromParam)) && Number.isFinite(Date.parse(toParam))
      ? { preset: 'custom' as const, fromMs: Date.parse(fromParam), toMs: Date.parse(toParam) }
      : undefined

  const query = useNarrativeQuery({
    scope: connectionId ? { kind: 'session', connectionId } : { kind: 'platform' },
    period: initialPeriod,
  })

  useEffect(() => {
    if (connectionId) query.setScope({ kind: 'session', connectionId })
  }, [connectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selection = useNarrativeSelection()

  useNarrativeTail({
    enabled: query.layers.liveTail,
    scope: query.scope,
    afterSequence: query.latestSequence,
    onEvents: query.appendEvents,
  })

  const onScopeChange = useCallback(
    (scope: typeof query.scope) => {
      query.setScope(scope)
      selection.clear()
      setSearchParams(
        (p) => {
          if (scope.kind === 'session') {
            p.set('sessionId', scope.connectionId)
            p.delete('connectionId')
          } else {
            p.delete('sessionId')
            p.delete('connectionId')
          }
          return p
        },
        { replace: true },
      )
    },
    [query, setSearchParams, selection],
  )

  const streamEvents = useMemo(() => {
    const fromChapters = query.narrative.chapters.flatMap((c) => c.beats.map((b) => b.event))
    if (fromChapters.length > 0) return fromChapters
    return query.narrative.clusters.flatMap((c) => c.beats.map((b) => b.event))
  }, [query.narrative.chapters, query.narrative.clusters])

  const selectedEvent: DiagnosticsEventRecord | null =
    selection.selection?.kind === 'beat'
      ? selection.selection.beat.event
      : selection.selection?.kind === 'cluster'
        ? (selection.selection.cluster.beats[0]?.event ?? null)
        : selection.selection?.kind === 'chapter'
          ? (selection.selection.chapter.beats[selection.selection.chapter.beats.length - 1]?.event ?? null)
          : null

  const onSelectEvent = useCallback(
    (event: DiagnosticsEventRecord) => {
      // Clicking the active fact again clears selection (empty inspector).
      if (
        (selection.selection?.kind === 'beat' && selection.selection.beat.event.id === event.id) ||
        (selection.selection?.kind === 'cluster' &&
          selection.selection.cluster.beats[0]?.event.id === event.id)
      ) {
        selection.clear()
        return
      }
      selection.selectBeat({ event, ms: Date.parse(event.utc), clusterKey: null })
    },
    [selection],
  )

  const onSelectChapter = useCallback(
    (chapter: Parameters<typeof selection.selectChapter>[0]) => {
      const interesting =
        [...chapter.beats].reverse().find((b) => eventTone(b.event) === 'fault') ??
        [...chapter.beats].reverse().find((b) => eventTone(b.event) !== 'metric') ??
        chapter.beats[chapter.beats.length - 1]
      if (!interesting) return
      selection.selectBeat({
        event: interesting.event,
        ms: Date.parse(interesting.event.utc),
        clusterKey: null,
      })
    },
    [selection],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (query.filters.search) {
        query.setFilters({ ...query.filters, search: '' })
        return
      }
      if (selection.selection) selection.clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, selection])

  // Drop selection only when the selected fact leaves the visible stream — never auto-pick a replacement.
  useEffect(() => {
    if (!selectedEvent) return
    if (streamEvents.length === 0 || !streamEvents.some((e) => e.id === selectedEvent.id)) {
      selection.clear()
    }
  }, [streamEvents, selectedEvent, selection])

  return (
    <div className="flex h-[calc(100dvh-3.5rem-1.75rem)] min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-baseline gap-2">
        <h1 className="text-sm font-semibold tracking-tight">Journal</h1>
        <p className="text-[11px] text-muted-foreground">Diagnostic facts</p>
      </div>

      <JournalToolbar
        scope={query.scope}
        onScopeChange={onScopeChange}
        period={query.period}
        onPeriodChange={query.setPeriod}
        grouping={grouping}
        onGroupingChange={setGrouping}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        filters={query.filters}
        onFiltersChange={query.setFilters}
        followNew={query.layers.liveTail}
        onFollowNewChange={(follow) => query.setLayers({ ...query.layers, liveTail: follow })}
        onRefresh={() => void query.reload()}
        factCount={streamEvents.length}
        loading={query.loading}
      />

      {query.error && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-sm text-destructive">
          {query.error}
          <button type="button" className="ml-2 underline" onClick={() => void query.reload()}>
            Retry
          </button>
        </div>
      )}

      {query.narrative.completeness.note && (
        <p className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">{query.narrative.completeness.note}</p>
      )}

      {!query.loading && (
        <AttentionStrip
          chapters={query.narrative.chapters}
          selectedKey={null}
          onSelect={onSelectChapter}
        />
      )}

      {query.loading && streamEvents.length === 0 ? (
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
      ) : (
        <div
          className={cn(
            'grid min-h-0 flex-1 grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(240px,34%)]',
            query.loading && 'opacity-60',
          )}
        >
          <JournalEventStream
            className="min-h-0"
            events={streamEvents}
            selectedId={selectedEvent?.id ?? null}
            onSelect={onSelectEvent}
            onFilterSession={
              query.scope.kind === 'session'
                ? undefined
                : (id) => onScopeChange({ kind: 'session', connectionId: id })
            }
            grouping={grouping}
            sortOrder={sortOrder}
            emptyHint={{
              onWidenPeriod: () => query.setPeriod({ preset: '6h', fromMs: null, toMs: null }),
            }}
          />
          <div className="min-h-0">
            {selectedEvent ? (
              <JournalFactDetail
                event={selectedEvent}
                onClose={selection.clear}
                onFilterSession={
                  selectedEvent.connectionId
                    ? () => onScopeChange({ kind: 'session', connectionId: selectedEvent.connectionId! })
                    : undefined
                }
              />
            ) : (
              <div
                id="journal-fact"
                className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-3 text-center"
                aria-label="Journal fact detail"
              >
                <p className="text-[12px] text-muted-foreground">Nothing selected</p>
                <p className="text-[10px] text-muted-foreground/80">Click a fact · Esc clears · ↑↓ moves</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
