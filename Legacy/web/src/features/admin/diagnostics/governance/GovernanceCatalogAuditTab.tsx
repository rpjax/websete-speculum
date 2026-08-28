import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  diagnosticsApi,
  type DiagnosticsEventDescriptor,
  type DiagnosticsEventRecord,
  type DiagnosticsOptions,
  type EffectiveCapabilities,
} from '@/lib/diagnosticsApi'
import {
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_LABELS,
  DOMAIN_BG,
  DOMAIN_DESCRIPTIONS,
  DOMAIN_LABELS,
  formatRelativeTime,
} from '@/lib/diagnosticsConstants'
import { describeEvent } from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  ExternalLink,
  Filter,
  HelpCircle,
  History,
  Lock,
  RefreshCw,
  ScrollText,
  Unlock,
} from 'lucide-react'
import {
  isCapabilityEffectivelyOn,
  resolveEffectivePreview,
} from './resolveEffectivePreview'

interface GovernanceCatalogAuditTabProps {
  config: DiagnosticsOptions
  overviewEffective?: EffectiveCapabilities
  overlays: { degraded: boolean; elevateActive: boolean }
}

function normalizeDescriptor(e: string | DiagnosticsEventDescriptor): DiagnosticsEventDescriptor | null {
  if (typeof e === 'string') {
    return { name: e, domain: 'unknown', capability: 'Metric', persist: true }
  }
  return e
}

export function GovernanceCatalogAuditTab({
  config,
  overlays,
}: GovernanceCatalogAuditTabProps) {
  const [catalog, setCatalog] = useState<DiagnosticsEventDescriptor[]>([])
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null)
  const [audit, setAudit] = useState<DiagnosticsEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [gatedOnly, setGatedOnly] = useState(false)
  const [domainFilter, setDomainFilter] = useState<string | 'all'>('all')

  const draftEffective = useMemo(
    () => resolveEffectivePreview(config, overlays),
    [config, overlays],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [cat, events] = await Promise.all([
        diagnosticsApi.getEventCatalog(),
        diagnosticsApi.listEvents({ since, namePrefix: 'Diagnostics.' }),
      ])
      setSchemaVersion(cat.diagnosticsSchemaVersion)
      setCatalog(
        (cat.events ?? [])
          .map(normalizeDescriptor)
          .filter((d): d is DiagnosticsEventDescriptor => d != null),
      )
      setAudit(
        [...events].sort((a, b) => new Date(b.utc).getTime() - new Date(a.utc).getTime()).slice(0, 40),
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog / audit')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const gatedCount = useMemo(
    () =>
      catalog.filter((d) => !isCapabilityEffectivelyOn(draftEffective, d.domain, d.capability)).length,
    [catalog, draftEffective],
  )

  const liveCount = catalog.length - gatedCount

  const domainsInCatalog = useMemo(() => {
    const set = new Set(catalog.map((d) => d.domain))
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [catalog])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter((d) => {
      if (domainFilter !== 'all' && d.domain !== domainFilter) return false
      const gated = !isCapabilityEffectivelyOn(draftEffective, d.domain, d.capability)
      if (gatedOnly && !gated) return false
      if (!q) return true
      return (
        d.name.toLowerCase().includes(q) ||
        d.domain.toLowerCase().includes(q) ||
        d.capability.toLowerCase().includes(q) ||
        (d.spanKey ?? '').toLowerCase().includes(q)
      )
    })
  }, [catalog, query, gatedOnly, draftEffective, domainFilter])

  const byDomain = useMemo(() => {
    const map = new Map<string, DiagnosticsEventDescriptor[]>()
    for (const d of filtered) {
      const list = map.get(d.domain) ?? []
      list.push(d)
      map.set(d.domain, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1 text-sm leading-relaxed">
          <p className="font-medium">Two related views</p>
          <p className="text-xs text-muted-foreground">
            <strong className="font-medium text-foreground">Event catalog</strong> is the dictionary of
            beats the pipeline knows how to emit — each one needs a domain capability from Coverage.
            <strong className="font-medium text-foreground"> Recent actions</strong> shows governance
            events from the last 24 hours (config apply, elevate, degrade, recover).
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 shrink-0 gap-1.5 text-xs"
          onClick={() => void load()}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="catalog">
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="catalog" className="gap-1.5">
            <ScrollText className="h-3.5 w-3.5" />
            Event catalog
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {catalog.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <History className="h-3.5 w-3.5" />
            Recent actions
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {audit.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Will emit"
              value={liveCount}
              hint="Events whose domain capability is on in your current draft (including Degraded / Elevate overlays)."
              tone="ok"
            />
            <StatCard
              label="Blocked by draft"
              value={gatedCount}
              hint="Events that would be dropped because the required capability is off — flip the matching Coverage switch (or Elevate for probes)."
              tone={gatedCount > 0 ? 'warn' : 'muted'}
            />
            <StatCard
              label="Schema"
              value={`v${schemaVersion ?? '?'}`}
              hint="Wire envelope version. v2 adds span correlation (spanId / spanKey / causationId) so Timeline can tell open→close stories."
              tone="muted"
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              How to read a catalog row
            </p>
            <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
              <LegendItem
                title="Capability"
                body="Signal kind required (Metrics, Events, Snapshots, or Browser Query). Controlled on the Coverage tab."
              />
              <LegendItem
                title="Stored"
                body="Persisted to the event store for Timeline / Analysis. Ring-only beats never show here as stored."
              />
              <LegendItem
                title="Span"
                body="Open/Close pairs form a story chapter (e.g. motor.navigate). Standalone beats have no span."
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <DomainChip
                active={domainFilter === 'all'}
                onClick={() => setDomainFilter('all')}
                label="All domains"
                count={catalog.length}
              />
              {domainsInCatalog.map((domain) => (
                <DomainChip
                  key={domain}
                  active={domainFilter === domain}
                  onClick={() => setDomainFilter(domain)}
                  label={DOMAIN_LABELS[domain] ?? domain}
                  count={catalog.filter((d) => d.domain === domain).length}
                  className={DOMAIN_BG[domain]}
                />
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Filter className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-8 text-sm"
                  placeholder="Search event name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <Switch checked={gatedOnly} onCheckedChange={setGatedOnly} />
                <span>
                  <span className="font-medium">Show blocked only</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    Events your draft would drop
                  </span>
                </span>
              </label>
            </div>
          </div>

          {byDomain.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No events match. Clear the search or turn off “Show blocked only”.
            </p>
          ) : (
            <Accordion
              type="multiple"
              defaultValue={byDomain.map(([d]) => d)}
              className="space-y-2"
            >
              {byDomain.map(([domain, events]) => {
                const domainGated = events.filter(
                  (d) => !isCapabilityEffectivelyOn(draftEffective, d.domain, d.capability),
                ).length
                return (
                  <AccordionItem
                    key={domain}
                    value={domain}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            DOMAIN_BG[domain] ?? 'bg-muted text-muted-foreground',
                          )}
                        >
                          {DOMAIN_LABELS[domain] ?? domain}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {events.length} event{events.length === 1 ? '' : 's'}
                          {domainGated > 0 && (
                            <>
                              {' · '}
                              <span className="text-warning">{domainGated} blocked</span>
                            </>
                          )}
                        </span>
                        <span className="hidden w-full text-[11px] font-normal text-muted-foreground sm:block">
                          {DOMAIN_DESCRIPTIONS[domain] ?? 'Catalogued events for this domain.'}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="border-t border-border/50 pb-0">
                      <ul className="divide-y divide-border/40">
                        {events.map((d) => (
                          <CatalogEventRow
                            key={d.name}
                            descriptor={d}
                            gated={!isCapabilityEffectivelyOn(draftEffective, d.domain, d.capability)}
                          />
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <div className="rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Governance actions (last 24h)</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  ConfigApplied, Elevate, Degraded, Recovered, StorageOverflow, and related self-events.
                  For the full motor story, open Timeline.
                </p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                <Link to="/admin/diagnostics/timeline">
                  Open Timeline <ExternalLink className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </div>

          {audit.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No governance events in the last 24 hours. Save a config change or Elevate to see activity here.
            </p>
          ) : (
            <ol className="relative space-y-0 rounded-xl border border-border bg-card">
              {audit.map((ev, i) => (
                <li
                  key={ev.id}
                  className={cn(
                    'flex gap-3 px-4 py-3.5',
                    i < audit.length - 1 && 'border-b border-border/40',
                  )}
                >
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{shortGovernanceName(ev.name)}</p>
                      <time className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(ev.utc)}
                      </time>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{ev.name}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {describeEvent(ev.name)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function shortGovernanceName(name: string): string {
  return name.replace(/^Diagnostics\./, '')
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint: string
  tone: 'ok' | 'warn' | 'muted'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">{hint}</TooltipContent>
        </Tooltip>
      </div>
      <p
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'ok' && 'text-success',
          tone === 'warn' && 'text-warning',
          tone === 'muted' && 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function LegendItem({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 leading-relaxed">{body}</p>
    </div>
  )
}

function DomainChip({
  active,
  onClick,
  label,
  count,
  className,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? className
            ? cn(className, 'ring-2 ring-primary/30')
            : 'border-primary/40 bg-primary/15 text-primary'
          : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}

function CatalogEventRow({
  descriptor: d,
  gated,
}: {
  descriptor: DiagnosticsEventDescriptor
  gated: boolean
}) {
  const capLabel = CAPABILITY_LABELS[d.capability] ?? d.capability
  const capHint = CAPABILITY_DESCRIPTIONS[d.capability]

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            gated ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success',
          )}
          title={gated ? 'Blocked by draft' : 'Will emit'}
        >
          {gated ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{d.name}</p>
            {gated && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                Blocked by draft
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{describeEvent(d.name)}</p>
          <dl className="mt-2.5 grid gap-1.5 text-[11px] sm:grid-cols-2">
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-muted-foreground/70">Needs</dt>
              <dd>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help font-medium text-foreground underline decoration-dotted decoration-muted-foreground/40">
                      {capLabel}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">{capHint}</TooltipContent>
                </Tooltip>
                {gated && (
                  <span className="text-warning"> — currently off</span>
                )}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-muted-foreground/70">Storage</dt>
              <dd className="font-medium text-foreground">
                {d.persist ? 'Kept in event store' : 'Ring / ephemeral only'}
              </dd>
            </div>
            {d.spanKey && (
              <div className="flex gap-1.5 sm:col-span-2">
                <dt className="shrink-0 text-muted-foreground/70">Span</dt>
                <dd className="font-medium text-foreground">
                  {d.spanRole === 'Open' ? 'Opens' : d.spanRole === 'Close' ? 'Closes' : 'Part of'}{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{d.spanKey}</code>
                  {d.spanTimeoutSec != null && (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      (timeout {d.spanTimeoutSec}s)
                    </span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </li>
  )
}
