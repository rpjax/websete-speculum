import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MultiSelectFilter } from '@/components/admin/MultiSelectFilter'
import { DOMAIN_LABELS, EVENT_DOMAINS } from '@/lib/diagnosticsConstants'
import { ChevronDown, MoreHorizontal, RefreshCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PeriodControl } from './PeriodControl'
import { GranularityControl } from './GranularityControl'
import { LayerToggles } from './LayerToggles'
import { ScopeControl } from './ScopeControl'
import type {
  NarrativeGranularity,
  NarrativeLayers,
  NarrativePeriod,
  NarrativeScope,
  ReadingFilters,
} from '../model/narrativeTypes'

const DOMAIN_OPTIONS = (EVENT_DOMAINS as readonly string[]).map((value) => ({
  value,
  label: DOMAIN_LABELS[value] ?? value,
}))

const SEVERITY_OPTIONS = [
  { value: 'Info', label: 'Info' },
  { value: 'Warning', label: 'Warning' },
  { value: 'Error', label: 'Error' },
  { value: 'Metric', label: 'Metric' },
]

interface ReadingStripProps {
  scope: NarrativeScope
  onScopeChange: (scope: NarrativeScope) => void
  period: NarrativePeriod
  onPeriodChange: (period: NarrativePeriod) => void
  granularity: NarrativeGranularity
  onGranularityChange: (g: NarrativeGranularity) => void
  layers: NarrativeLayers
  onLayersChange: (layers: NarrativeLayers) => void
  filters: ReadingFilters
  onFiltersChange: (filters: ReadingFilters) => void
  onRefresh: () => void
  analysisHref: string
  stats: { beats: number; lanes: number; chapters: number }
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}

/**
 * Single compact reading chrome — one primary row (~40px). Filters live under Options.
 */
export function ReadingStrip({
  scope,
  onScopeChange,
  period,
  onPeriodChange,
  granularity,
  onGranularityChange,
  layers,
  onLayersChange,
  filters,
  onFiltersChange,
  onRefresh,
  analysisHref,
  stats,
  onZoomIn,
  onZoomOut,
  onFit,
}: ReadingStripProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const statsLabel = `${stats.beats} beats · ${stats.lanes} lanes · ${stats.chapters} chapters`
  const filterActive =
    filters.domains.length > 0 || filters.severities.length > 0 || filters.search.trim().length > 0

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Primary strip: nowrap single row */}
      <div className="flex h-10 items-center gap-1.5 overflow-x-auto px-2.5">
        <ScopeControl scope={scope} onChange={onScopeChange} compact />
        <PeriodControl period={period} onChange={onPeriodChange} compact />
        <GranularityControl value={granularity} onChange={onGranularityChange} compact />

        <div
          className="flex shrink-0 items-center rounded-md border border-border/80"
          role="group"
          aria-label="Zoom"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-none rounded-l-md p-0"
            onClick={onZoomOut}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-none border-x border-border/80 p-0"
            onClick={onZoomIn}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-none rounded-r-md p-0"
            onClick={onFit}
            aria-label="Fit to data"
            title="Fit"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOptionsOpen((v) => !v)}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px]',
            optionsOpen || filterActive
              ? 'border-primary/40 bg-primary/5 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
          aria-expanded={optionsOpen}
          aria-label="Reading options"
        >
          Options
          {filterActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
          <ChevronDown className={cn('h-3 w-3 transition-transform', optionsOpen && 'rotate-180')} />
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {layers.liveTail && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              Live
            </span>
          )}
          <span
            className="hidden tabular-nums text-[10px] text-muted-foreground lg:inline"
            title={statsLabel}
          >
            {stats.beats}·{stats.lanes}·{stats.chapters}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onRefresh}
            aria-label="Refresh narrative"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <div className="relative" ref={menuRef}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label="More actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-border bg-card p-1 shadow-md">
                <Link
                  to={analysisHref}
                  className="block rounded-sm px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  onClick={() => setMenuOpen(false)}
                >
                  Analyze this period…
                </Link>
                <p className="px-3 pb-2 text-[10px] text-muted-foreground/80">
                  Prefills Analysis only. Tools stay independent.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {optionsOpen && (
        <div className="space-y-3 border-t border-border px-3 py-2.5">
          <p className="text-[10px] tabular-nums text-muted-foreground sm:hidden">{statsLabel}</p>
          <LayerToggles layers={layers} onChange={onLayersChange} />
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectFilter
              label="Domain"
              options={DOMAIN_OPTIONS}
              selected={filters.domains}
              onChange={(domains) => onFiltersChange({ ...filters, domains })}
            />
            <MultiSelectFilter
              label="Severity"
              options={SEVERITY_OPTIONS}
              selected={filters.severities}
              onChange={(severities) => onFiltersChange({ ...filters, severities })}
            />
            <Input
              value={filters.search}
              onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
              placeholder="Search narrative…"
              className="h-8 max-w-xs text-xs"
              aria-label="Search narrative"
            />
          </div>
        </div>
      )}
    </div>
  )
}
