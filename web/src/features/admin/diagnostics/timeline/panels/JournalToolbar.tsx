import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown, Pause, RefreshCw, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PeriodControl } from '../reading/PeriodControl'
import { ScopeControl } from '../reading/ScopeControl'
import type { NarrativePeriod, NarrativeScope, ReadingFilters } from '../model/narrativeTypes'
import { JOURNAL_SOURCES } from '../model/journalSources'
import type { JournalGroupingOptions, JournalSortOrder } from './journalStreamModel'

const SEVERITY_OPTIONS = [
  { value: 'Info', label: 'Info' },
  { value: 'Warning', label: 'Warning' },
  { value: 'Error', label: 'Error' },
  { value: 'Metric', label: 'Metric' },
] as const

interface JournalToolbarProps {
  scope: NarrativeScope
  onScopeChange: (scope: NarrativeScope) => void
  period: NarrativePeriod
  onPeriodChange: (period: NarrativePeriod) => void
  grouping: JournalGroupingOptions
  onGroupingChange: (g: JournalGroupingOptions) => void
  sortOrder: JournalSortOrder
  onSortOrderChange: (v: JournalSortOrder) => void
  filters: ReadingFilters
  onFiltersChange: (filters: ReadingFilters) => void
  followNew: boolean
  onFollowNewChange: (v: boolean) => void
  onRefresh: () => void
  factCount: number
  loading?: boolean
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function MenuButton({
  label,
  active,
  count,
  children,
}: {
  label: string
  active?: boolean
  count?: number
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-7 gap-1 px-2 text-[11px] font-normal',
            active && 'border-primary/40 bg-primary/5 text-primary',
          )}
        >
          {label}
          {typeof count === 'number' && count > 0 ? (
            <span className="rounded bg-primary/15 px-1 tabular-nums text-[10px] text-primary">{count}</span>
          ) : null}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-3" align="start">
        {children}
      </PopoverContent>
    </Popover>
  )
}

function CheckRow({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean
  label: string
  hint?: string
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-muted/40">
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-[12px] text-foreground">{label}</span>
        {hint ? <span className="block text-[10px] text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  )
}

export function JournalToolbar({
  scope,
  onScopeChange,
  period,
  onPeriodChange,
  grouping,
  onGroupingChange,
  sortOrder,
  onSortOrderChange,
  filters,
  onFiltersChange,
  followNew,
  onFollowNewChange,
  onRefresh,
  factCount,
  loading,
}: JournalToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sourceCount = filters.domains.length
  const severityCount = filters.severities.length
  const filterCount = sourceCount + severityCount
  const groupCount = grouping.groupSessionFacts ? 1 : 0

  return (
    <div className="shrink-0 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <ScopeControl scope={scope} onChange={onScopeChange} compact hideWhenNoChoices />
        <PeriodControl period={period} onChange={onPeriodChange} compact />

        <div className="relative min-w-[10rem] flex-1 basis-[10rem]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filters.search) {
                e.preventDefault()
                e.stopPropagation()
                onFiltersChange({ ...filters, search: '' })
              }
            }}
            placeholder="Search… (Ctrl+F)"
            className={cn('h-7 pl-7 text-[11px]', filters.search && 'pr-7')}
            aria-label="Search facts"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          {filters.search ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              onClick={() => {
                onFiltersChange({ ...filters, search: '' })
                searchRef.current?.focus()
              }}
            >
              <span className="block text-[11px] leading-none">×</span>
            </button>
          ) : null}
        </div>

        <MenuButton label="Filters" active={filterCount > 0} count={filterCount || undefined}>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Source</p>
            <p className="mb-1.5 text-[10px] text-muted-foreground">
              Durable Journal type families (not legacy diagnostics domains).
            </p>
            {JOURNAL_SOURCES.map((s) => (
              <CheckRow
                key={s.value}
                checked={filters.domains.includes(s.value)}
                label={s.label}
                hint={s.hint}
                onChange={() =>
                  onFiltersChange({ ...filters, domains: toggleInList(filters.domains, s.value) })
                }
              />
            ))}
            {filters.domains.length > 0 && (
              <button
                type="button"
                className="mt-1 text-[10px] text-primary hover:underline"
                onClick={() => onFiltersChange({ ...filters, domains: [] })}
              >
                Clear sources (show all)
              </button>
            )}
          </div>
          <div className="border-t border-border pt-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Severity</p>
            <p className="mb-1.5 text-[10px] text-muted-foreground">Inferred from the fact name (not stored).</p>
            {SEVERITY_OPTIONS.map((s) => (
              <CheckRow
                key={s.value}
                checked={filters.severities.includes(s.value)}
                label={s.label}
                onChange={() =>
                  onFiltersChange({ ...filters, severities: toggleInList(filters.severities, s.value) })
                }
              />
            ))}
            {filters.severities.length > 0 && (
              <button
                type="button"
                className="mt-1 text-[10px] text-primary hover:underline"
                onClick={() => onFiltersChange({ ...filters, severities: [] })}
              >
                Clear severities (show all)
              </button>
            )}
          </div>
        </MenuButton>

        <MenuButton label="Group" active={groupCount > 0} count={groupCount || undefined}>
          <p className="text-[10px] text-muted-foreground">
            Fold correlated facts into one row. Everything else stays loose and chronological.
          </p>
          <CheckRow
            checked={grouping.groupSessionFacts}
            label="Session facts"
            hint="Facts sharing the same session id (2+)"
            onChange={(v) => onGroupingChange({ ...grouping, groupSessionFacts: v })}
          />
        </MenuButton>

        <MenuButton label="Sort" active={sortOrder !== 'newest'}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Order</p>
          {(
            [
              { value: 'newest' as const, label: 'Newest first', hint: 'Default for live diagnosis' },
              { value: 'oldest' as const, label: 'Oldest first', hint: 'Read the story forward' },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onSortOrderChange(o.value)}
              className={cn(
                'flex w-full flex-col rounded-md px-2 py-1.5 text-left',
                sortOrder === o.value ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40',
              )}
            >
              <span className="text-[12px] font-medium">{o.label}</span>
              <span className="text-[10px] text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </MenuButton>

        <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">
          {loading ? 'Loading…' : `${factCount} fact${factCount === 1 ? '' : 's'}`}
        </span>

        <button
          type="button"
          onClick={() => onFollowNewChange(!followNew)}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]',
            followNew
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground',
          )}
          aria-pressed={followNew}
          title={followNew ? 'New facts append automatically' : 'Paused'}
        >
          {followNew ? (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          ) : (
            <Pause className="h-3 w-3" />
          )}
          {followNew ? 'Auto-update' : 'Paused'}
        </button>

        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onRefresh} aria-label="Reload">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
