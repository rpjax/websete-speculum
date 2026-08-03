import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Layers, ListTree, Plus, Radio, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { adminJson } from '@/lib/adminFetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  DataCard,
  EmptyState,
  GuidedPreset,
  HelperCallout,
  InlineValidation,
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
  customKeysOutsideCatalog,
  filterCatalog,
  groupByCategory,
  isFactEnabled,
  isJournalToggleable,
  isTelemetryOwned,
  optionalCatalog,
  removeJournalEvent,
  setFilteredOptIns,
  setJournalEvent,
  summarizeJournal,
  type JournalCatalogEntry,
  type JsonObject,
} from './journalHelpers'

function FactRow({
  entry,
  enabled,
  onToggle,
}: {
  entry: JournalCatalogEntry
  enabled: boolean
  onToggle?: (checked: boolean) => void
}) {
  const toggleable = isJournalToggleable(entry)
  return (
    <li className="flex items-start justify-between gap-3 px-2 py-2.5 sm:px-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium leading-tight">{entry.name || entry.type}</p>
          {entry.isCanonical ? <StatusPill label="Canonical" tone="success" /> : null}
          {isTelemetryOwned(entry.type) ? <StatusPill label="Telemetry" tone="info" /> : null}
        </div>
        {entry.description ? (
          <p className="text-xs text-muted-foreground">{entry.description}</p>
        ) : null}
        <p className="font-mono text-[11px] text-muted-foreground">{entry.type}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {toggleable && onToggle ? (
          <>
            <Label htmlFor={`journal-${entry.type}`} className="text-xs text-muted-foreground">
              {enabled ? 'On' : 'Off'}
            </Label>
            <Switch
              id={`journal-${entry.type}`}
              checked={enabled}
              onCheckedChange={onToggle}
            />
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
}: {
  value: JsonObject
  replace: (next: JsonObject) => void
}) {
  const [catalog, setCatalog] = useState<JournalCatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [draftFact, setDraftFact] = useState('')
  const onQueryChange = useCallback((next: string) => setQuery(next), [])

  const events = asEventsMap(value.events)
  const summary = summarizeJournal(catalog, events)
  const optional = catalog ? optionalCatalog(catalog) : []
  const filteredOptional = filterCatalog(optional, query)
  const filteredToggleable = filteredOptional.filter(isJournalToggleable)
  const grouped = groupByCategory(filteredOptional)
  const customKeys = customKeysOutsideCatalog(events, catalog)

  const patchEvents = (next: typeof events) => replace({ ...value, events: next })

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={summary.statusLabel}
          tone={summary.enabledOptIns ? 'success' : 'neutral'}
        />
        <StatusPill
          label={`Catalog · ${summary.catalogSize || '—'}`}
          tone={catalog ? 'info' : 'neutral'}
        />
        <StatusPill
          label={`Categories · ${summary.categoryCount || '—'}`}
          tone={summary.categoryCount ? 'info' : 'neutral'}
        />
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
        <div>
          <h3 className="text-sm font-medium">Guided presets</h3>
          <p className="text-xs text-muted-foreground">
            Presets only change Journal-owned opt-ins. They never disable canonical facts or write Telemetry keys
            into this section.
          </p>
        </div>
        <GuidedPreset
          presets={JOURNAL_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label,
            apply: () => patchEvents(applyJournalPreset(events, preset.id, catalog)),
          }))}
        />
        <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          {JOURNAL_PRESETS.map((preset) => (
            <li key={preset.id} className="rounded-md border border-border/70 bg-background/40 px-2.5 py-2">
              <p className="font-medium text-foreground">{preset.label}</p>
              <p className="mt-0.5">{preset.description}</p>
            </li>
          ))}
        </ul>
        {summary.telemetryOwnedCount ? (
          <p className="text-xs text-muted-foreground">
            {summary.telemetryOwnedCount} Telemetry-owned catalog facts are browse-only here —{' '}
            <Link className="font-medium underline" to="/w7s/admin/configurations/Telemetry">
              open Telemetry controls
            </Link>
            .
          </p>
        ) : null}
      </DataCard>

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
              disabled={!filteredToggleable.length}
              onClick={() => patchEvents(setFilteredOptIns(events, filteredToggleable, true, catalog))}
            >
              Enable filtered
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!filteredToggleable.length}
              onClick={() => patchEvents(setFilteredOptIns(events, filteredToggleable, false, catalog))}
            >
              Disable filtered
            </Button>
          </div>
        </div>

        {catalogError ? <InlineValidation message={catalogError} /> : null}

        {catalog === null && !catalogError ? (
          <p className="text-sm text-muted-foreground">Loading available fact types…</p>
        ) : null}

        {catalog && !catalog.length ? (
          <EmptyState
            title="Catalog empty"
            body="No Journal fact types are registered yet. Retry after the API finishes discovery."
          />
        ) : null}

        {catalog && catalog.length > 0 && !filteredOptional.length ? (
          <EmptyState
            title="No matching facts"
            body="Clear the search or try a different type prefix (Sessions, Profiles, Telemetry)."
            cta={{ label: 'Clear search', onClick: () => setQuery('') }}
          />
        ) : null}

        {grouped.map((group) => (
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
                  onToggle={
                    isJournalToggleable(entry)
                      ? (checked) => patchEvents(setJournalEvent(events, entry.type, checked, catalog))
                      : undefined
                  }
                />
              ))}
            </ul>
          </div>
        ))}
      </section>

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
                    onCheckedChange={(checked) =>
                      patchEvents(setJournalEvent(events, key, checked, catalog))
                    }
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
            <Button type="submit" size="sm" variant="outline">
              <Plus className="h-4 w-4" />
              Enable fact
            </Button>
          </form>
        </div>
      </RevealPanel>

      {catalog && summary.canonicalCount ? (
        <RevealPanel title={`Canonical facts (${summary.canonicalCount}) — always recorded`}>
          <ul className="divide-y divide-border">
            {filterCatalog(
              catalog.filter((entry) => entry.isCanonical),
              query,
            ).map((entry) => (
              <FactRow key={entry.type} entry={entry} enabled />
            ))}
          </ul>
        </RevealPanel>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ListTree className="h-3.5 w-3.5" />
        <span>
          Showing {filteredOptional.length}
          {query.trim() ? ` of ${optional.length}` : ''} optional facts
          {query.trim() ? ` matching “${query.trim()}”` : ''}
          {filteredToggleable.length
            ? ` · ${filteredToggleable.length} Journal-togglable in view`
            : ''}
          .
        </span>
      </div>
    </div>
  )
}
