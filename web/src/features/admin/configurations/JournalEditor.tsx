import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Check, Layers, ListTree, Plus, Radio, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { adminJson } from '@/lib/adminFetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  DataCard,
  EmptyState,
  HelperCallout,
  MetaRow,
  RevealPanel,
  SearchFilter,
  StatCard,
  StatusPill,
} from '@/features/admin/components'
import {
  JOURNAL_PRESETS,
  applyJournalPreset,
  asEventsMap,
  canonicalCatalog,
  customKeysOutsideCatalog,
  filterCatalog,
  groupByCategory,
  isFactEnabled,
  isJournalToggleable,
  isTelemetryOwned,
  removeJournalEvent,
  setFilteredOptIns,
  setJournalEvent,
  summarizeJournal,
  telemetryOwnedOptional,
  toggleableCatalog,
  type JournalCatalogEntry,
  type JournalPresetId,
  type JsonObject,
} from './journalHelpers'

function FactRow({
  entry,
  enabled,
  onToggle,
  dense,
}: {
  entry: JournalCatalogEntry
  enabled: boolean
  onToggle?: (checked: boolean) => void
  dense?: boolean
}) {
  const toggleable = isJournalToggleable(entry)
  return (
    <li
      className={cn(
        'flex items-start justify-between gap-3',
        dense ? 'px-2 py-2 sm:px-2.5' : 'px-2 py-2.5 sm:px-3',
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-medium leading-tight">{entry.name || entry.type}</p>
          {entry.isCanonical ? <StatusPill label="Canonical" tone="success" /> : null}
          {isTelemetryOwned(entry.type) ? <StatusPill label="Telemetry" tone="info" /> : null}
        </div>
        {entry.description ? (
          <p className="text-xs text-muted-foreground line-clamp-2">{entry.description}</p>
        ) : null}
        <p className="truncate font-mono text-[11px] text-muted-foreground">{entry.type}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {toggleable && onToggle ? (
          <>
            <Label htmlFor={`journal-${entry.type}`} className="sr-only sm:not-sr-only sm:text-xs sm:text-muted-foreground">
              {enabled ? 'On' : 'Off'}
            </Label>
            <Switch id={`journal-${entry.type}`} checked={enabled} onCheckedChange={onToggle} />
          </>
        ) : isTelemetryOwned(entry.type) ? (
          <StatusPill label={enabled ? 'On via Telemetry' : 'Off via Telemetry'} tone={enabled ? 'success' : 'neutral'} />
        ) : (
          <StatusPill label="Always on" tone="success" />
        )}
      </div>
    </li>
  )
}

export function JournalEditor({
  value,
  replace,
  onValidityChange,
}: {
  value: JsonObject
  replace: (next: JsonObject) => void
  onValidityChange?: (ok: boolean) => void
}) {
  const [catalog, setCatalog] = useState<JournalCatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [draftFact, setDraftFact] = useState('')
  const [pickedPreset, setPickedPreset] = useState<JournalPresetId | null>(null)
  const onQueryChange = useCallback((next: string) => setQuery(next), [])

  const events = asEventsMap(value.events)
  const summary = summarizeJournal(catalog, events)
  const toggleable = catalog ? toggleableCatalog(catalog) : []
  const telemetryOwned = catalog ? telemetryOwnedOptional(catalog) : []
  const filteredToggleable = filterCatalog(toggleable, query)
  const filteredTelemetryOwned = filterCatalog(telemetryOwned, query)
  const grouped = groupByCategory(filteredToggleable)
  const customKeys = customKeysOutsideCatalog(events, catalog)

  const patchEvents = (next: typeof events) => replace({ ...value, events: next })

  useEffect(() => {
    // Block save when catalog is known and events contain keys the API will reject.
    if (!onValidityChange) return
    if (catalog === null) {
      onValidityChange(!catalogError)
      return
    }
    onValidityChange(customKeys.length === 0)
  }, [catalog, catalogError, customKeys.length, onValidityChange])

  useEffect(() => {
    let active = true
    adminJson<JournalCatalogEntry[]>('/api/journal/catalog')
      .then((response) => {
        if (!active) return
        setCatalog(Array.isArray(response) ? response : [])
      })
      .catch((reason: unknown) => {
        if (!active) return
        setCatalogError(reason instanceof Error ? reason.message : 'Unable to load the Journal catalog.')
      })
    return () => {
      active = false
    }
  }, [])

  const applyPreset = (id: JournalPresetId) => {
    setPickedPreset(id)
    patchEvents(applyJournalPreset(events, id, catalog))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusPill label={summary.statusLabel} tone={summary.enabledOptIns ? 'success' : 'neutral'} />
        <StatusPill label={`Catalog · ${summary.catalogSize || '—'}`} tone={catalog ? 'info' : 'neutral'} />
        <StatusPill label={`Categories · ${summary.categoryCount || '—'}`} tone={summary.categoryCount ? 'info' : 'neutral'} />
        {summary.canonicalCount ? (
          <StatusPill label={`Canonical · ${summary.canonicalCount}`} tone="success" />
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Opt-ins on"
          value={catalog ? summary.enabledOptIns : '—'}
          icon={<Radio className="h-4 w-4" />}
          sub={
            catalog
              ? `${summary.toggleableCount} Journal-owned · ${summary.telemetryOwnedCount} Telemetry-owned`
              : 'Waiting for catalog'
          }
          tone={summary.enabledOptIns ? 'success' : 'default'}
        />
        <StatCard
          label="Catalog size"
          value={catalog ? summary.catalogSize : '—'}
          icon={<BookOpen className="h-4 w-4" />}
          sub={
            catalog
              ? `${summary.optionalCount} optional · ${summary.canonicalCount} always on`
              : 'Loading fact types'
          }
        />
        <StatCard
          label="Categories"
          value={catalog ? summary.categoryCount : '—'}
          icon={<Layers className="h-4 w-4" />}
          sub={
            summary.categories.length
              ? summary.categories.slice(0, 3).join(', ') +
                (summary.categories.length > 3 ? '…' : '')
              : 'Owner / type prefix'
          }
        />
      </div>

      <HelperCallout
        title="Canonical facts stay on"
        action={{ label: 'Open Journal', href: '/w7s/admin/diagnostics/timeline' }}
      >
        Canonical lifecycle facts are always recorded. Journal opt-ins add retention and noise cost — enable only
        what helps an investigation. Telemetry event facts are configured under Telemetry, not here.
      </HelperCallout>

      <DataCard className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Guided presets</h3>
          <p className="text-xs text-muted-foreground">
            Presets only change Journal-owned opt-ins. They never disable canonical facts or write Telemetry keys
            into this section.
          </p>
        </div>
        <div role="radiogroup" aria-label="Journal presets" className="grid gap-2 sm:grid-cols-2">
          {JOURNAL_PRESETS.map((preset) => {
            const selected = pickedPreset === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => applyPreset(preset.id)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background/40 hover:bg-muted/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{preset.label}</p>
                  {selected ? (
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" aria-hidden />
                    </span>
                  ) : (
                    <span
                      className="mt-0.5 inline-flex h-5 w-5 shrink-0 rounded-full border border-border"
                      aria-hidden
                    />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
              </button>
            )
          })}
        </div>
        {summary.telemetryOwnedCount ? (
          <p className="text-xs text-muted-foreground">
            {summary.telemetryOwnedCount} Telemetry-owned catalog facts are browse-only —{' '}
            <Link className="font-medium underline" to="/w7s/admin/configurations/Telemetry">
              open Telemetry controls
            </Link>
            .
          </p>
        ) : null}
      </DataCard>

      {catalog === null && !catalogError ? (
        <HelperCallout title="Loading fact catalog">
          Fetching registered Journal fact types from the API. Opt-in toggles appear once discovery completes.
        </HelperCallout>
      ) : null}

      {catalogError ? (
        <HelperCallout tone="warning" title="Catalog unavailable">
          {catalogError} Retry by refreshing the page or check that the API is reachable.
        </HelperCallout>
      ) : null}

      {catalog && !catalog.length ? (
        <EmptyState
          title="Catalog empty"
          body="No Journal fact types are registered yet. Retry after the API finishes discovery."
        />
      ) : null}

      {catalog && catalog.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1">
              <SearchFilter
                value={query}
                onChange={onQueryChange}
                placeholder="Search fact name, type, or category"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={!filteredToggleable.length}
                onClick={() => patchEvents(setFilteredOptIns(events, filteredToggleable, true, catalog))}
              >
                Enable filtered
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={!filteredToggleable.length}
                onClick={() => patchEvents(setFilteredOptIns(events, filteredToggleable, false, catalog))}
              >
                Disable filtered
              </Button>
            </div>
          </div>

          {!filteredToggleable.length ? (
            <EmptyState
              title="No matching Journal opt-ins"
              body="Clear the search or try a different type prefix (Sessions, Profiles)."
              cta={{ label: 'Clear search', onClick: () => setQuery('') }}
            />
          ) : (
            grouped.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <div className="flex items-center gap-2 px-1">
                  <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.category}
                  </h4>
                  <span className="text-xs text-muted-foreground">· {group.entries.length}</span>
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border bg-background/40">
                  {group.entries.map((entry) => (
                    <FactRow
                      key={entry.type}
                      entry={entry}
                      enabled={isFactEnabled(entry, events)}
                      dense
                      onToggle={(checked) => patchEvents(setJournalEvent(events, entry.type, checked, catalog))}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      ) : null}

      {customKeys.length ? (
        <DataCard className="space-y-2 p-3">
          <h3 className="text-sm font-medium">Keys outside catalog</h3>
          <p className="text-xs text-muted-foreground">
            Present in the saved events map but not in the live catalog. Remove unknown keys before save or they
            will be rejected.
          </p>
          <ul className="divide-y divide-border">
            {customKeys.map((key) => (
              <li key={key} className="flex items-center justify-between gap-2 py-2">
                <MetaRow className="min-w-0 justify-start gap-2">
                  <span className="truncate font-mono text-xs">{key}</span>
                  <StatusPill label={events[key] ? 'On' : 'Off'} tone={events[key] ? 'success' : 'neutral'} />
                </MetaRow>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={Boolean(events[key])}
                    onCheckedChange={(checked) => patchEvents(setJournalEvent(events, key, checked, catalog))}
                    aria-label={`Toggle ${key}`}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label={`Remove ${key}`}
                    onClick={() => patchEvents(removeJournalEvent(events, key, catalog))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </DataCard>
      ) : null}

      {catalog && telemetryOwned.length > 0 ? (
        <RevealPanel title={`Telemetry-owned facts (${telemetryOwned.length}) — browse only`}>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              These facts follow Telemetry configuration. Status reflects the catalog — toggle them under{' '}
              <Link className="font-medium underline" to="/w7s/admin/configurations/Telemetry">
                Telemetry
              </Link>
              .
            </p>
            {filteredTelemetryOwned.length === 0 && query.trim() ? (
              <EmptyState
                title="No matching Telemetry facts"
                body="Clear the search to browse all Telemetry-owned catalog entries."
                cta={{ label: 'Clear search', onClick: () => setQuery('') }}
              />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-background/40">
                {filteredTelemetryOwned.map((entry) => (
                  <FactRow key={entry.type} entry={entry} enabled={isFactEnabled(entry, events)} dense />
                ))}
              </ul>
            )}
          </div>
        </RevealPanel>
      ) : null}

      <RevealPanel title="Add custom fact key (fallback)">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Prefer catalog toggles. Custom keys must already exist as non-canonical, non-Telemetry Journal facts —
            unknown or Telemetry-owned types are rejected on save.
          </p>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              const key = draftFact.trim()
              if (!key || isTelemetryOwned(key) || events[key]) return
              patchEvents(setJournalEvent(events, key, true, catalog))
              setDraftFact('')
            }}
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="journal-fact-draft">Fact type</Label>
              <Input
                id="journal-fact-draft"
                className="font-mono text-xs"
                placeholder="Domain.Event.Name"
                value={draftFact}
                onChange={(event) => setDraftFact(event.target.value)}
              />
            </div>
            <Button type="submit" size="sm" variant="outline" className="w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              Enable fact
            </Button>
          </form>
        </div>
      </RevealPanel>

      {catalog && summary.canonicalCount ? (
        <RevealPanel title={`Canonical facts (${summary.canonicalCount}) — always recorded`}>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background/40">
            {filterCatalog(canonicalCatalog(catalog), query).map((entry) => (
              <FactRow key={entry.type} entry={entry} enabled dense />
            ))}
          </ul>
        </RevealPanel>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ListTree className="h-3.5 w-3.5" />
        <span>
          Showing {filteredToggleable.length}
          {query.trim() ? ` of ${toggleable.length}` : ''} Journal opt-ins
          {query.trim() ? ` matching “${query.trim()}”` : ''}
          {filteredTelemetryOwned.length && query.trim()
            ? ` · ${filteredTelemetryOwned.length} Telemetry-owned in view`
            : ''}
          .
        </span>
      </div>
    </div>
  )
}
