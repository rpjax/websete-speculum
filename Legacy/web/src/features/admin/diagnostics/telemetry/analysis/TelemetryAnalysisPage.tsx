import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExportButton } from '@/components/admin/ExportButton'
import { TelemetrySubNav } from '../TelemetrySubNav'
import {
  useTelemetryAnalysisConsume,
  type AnalysisRange,
  type AnalysisRangePreset,
} from './useTelemetryAnalysisConsume'
import type {
  TelemetryAnalysisReport,
  AnalysisChapter,
  EvidenceRef,
} from '@/lib/telemetryAnalysis'
import { diagnosticsApi, type DiagnosticsEventRecord, type TelemetrySampleRecord } from '@/lib/diagnosticsApi'
import { telemetryToResourceSamples } from '@/lib/resourceChartCompute'
import { cn } from '@/lib/utils'
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Loader2, Play, Square, BookOpen, Shield, Lightbulb, GitBranch, Table2,
} from 'lucide-react'

const PRESETS: { value: AnalysisRangePreset; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
]

const VERDICT_STYLE: Record<string, string> = {
  healthy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  watch: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  degraded: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  critical: 'border-red-500/30 bg-red-500/10 text-red-300',
}

export default function TelemetryAnalysisPage() {
  const [range, setRange] = useState<AnalysisRange>({ preset: '6h', from: null, to: null })
  const { progress, report, error, run, cancel } = useTelemetryAnalysisConsume()
  const [dive, setDive] = useState<EvidenceRef | null>(null)
  const running = progress.phase === 'samples' || progress.phase === 'events' || progress.phase === 'context' || progress.phase === 'compose'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TelemetrySubNav />
        <p className="text-[11px] text-muted-foreground/60 max-w-2xl">
          Machine-led analysis independent of Monitor. Pick any window, run the analyzer, and get a complete report — runtime overlays are secondary chapters.
        </p>
      </div>

      {/* Independent window + run */}
      <div className="rounded-lg border border-border bg-card px-3 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="h-4 w-4 text-primary/70" />
          <span className="text-sm font-semibold">Analysis workspace</span>
          <span className="text-[11px] text-muted-foreground/50">Owns its own time window</span>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground/60 mb-1">Window</p>
            <div className="flex rounded-md border border-border/40 overflow-hidden">
              {PRESETS.map((p) => (
                <button key={p.value} onClick={() => setRange((r) => ({ ...r, preset: p.value }))}
                  className={cn('px-2.5 py-1 text-xs font-medium',
                    range.preset === p.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  {p.label}
                </button>
              ))}
              <button onClick={() => setRange((r) => ({ ...r, preset: 'custom' }))}
                className={cn('px-2.5 py-1 text-xs font-medium',
                  range.preset === 'custom' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                Custom
              </button>
            </div>
          </div>
          {range.preset === 'custom' && (
            <>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground/60 mb-1">From</p>
                <Input type="datetime-local" className="h-8 text-xs w-[180px]"
                  onChange={(e) => {
                    const ts = e.target.value ? new Date(e.target.value).getTime() : null
                    setRange((r) => ({ ...r, from: ts, preset: 'custom' }))
                  }} />
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground/60 mb-1">To</p>
                <Input type="datetime-local" className="h-8 text-xs w-[180px]"
                  onChange={(e) => {
                    const ts = e.target.value ? new Date(e.target.value).getTime() : null
                    setRange((r) => ({ ...r, to: ts, preset: 'custom' }))
                  }} />
              </div>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {running ? (
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={cancel}>
                <Square className="h-3 w-3" /> Cancel
              </Button>
            ) : (
              <Button size="sm" className="h-8 gap-1.5" onClick={() => void run(range)}>
                <Play className="h-3.5 w-3.5" /> Run analysis
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{progress.message}</span>
          {progress.total > 0 && progress.phase === 'samples' && (
            <span className="tabular-nums text-muted-foreground/50">
              {progress.loaded.toLocaleString()} / {progress.total.toLocaleString()}
            </span>
          )}
        </div>
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </div>
        )}
      </div>

      {report && (
        <>
          <ExecutiveBlock report={report} />
          <div className="flex justify-end">
            <ExportButton data={report} filename="telemetry-analysis-report" className="h-7 text-[11px]" />
          </div>
          <div className="space-y-3">
            {report.chapters.map((ch) => (
              <ChapterCard key={ch.id} chapter={ch} onDive={setDive} />
            ))}
          </div>
          <Expandable title="Metric atlas (all present metrics)" icon={<Table2 className="h-3.5 w-3.5" />} defaultOpen={false}>
            <div className="divide-y divide-border/10">
              {report.metricAtlas.filter((m) => m.present).map((m) => (
                <div key={m.key} className="px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground/50 uppercase">{m.section}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                      avg {round(m.avg)}{m.unit} · max {round(m.max)}{m.unit}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{m.narrative}</p>
                </div>
              ))}
            </div>
          </Expandable>
          <Expandable title="Correlations" icon={<GitBranch className="h-3.5 w-3.5" />} defaultOpen>
            <div className="divide-y divide-border/10">
              {report.correlations.map((c, i) => (
                <div key={i} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{c.yLabel} vs {c.xLabel}</span>
                    <span className={cn('text-[10px] font-medium', c.healthy ? 'text-emerald-400' : 'text-amber-400')}>
                      r={c.r.toFixed(2)} · {c.strength}{c.expected ? (c.healthy ? ' · healthy' : ' · broken') : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{c.narrative}</p>
                </div>
              ))}
            </div>
          </Expandable>
          <Expandable title="Chronology" icon={<BookOpen className="h-3.5 w-3.5" />} defaultOpen={false}>
            <div className="divide-y divide-border/10">
              {report.chronology.map((c, i) => (
                <div key={i} className="px-3 py-2 flex gap-3">
                  <span className="text-[10px] tabular-nums text-muted-foreground/60 shrink-0 w-20">
                    {new Date(c.utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div>
                    <p className={cn('text-xs font-medium',
                      c.severity === 'error' ? 'text-red-400' : c.severity === 'warning' ? 'text-amber-400' : '')}>
                      {c.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-snug">{c.detail}</p>
                  </div>
                </div>
              ))}
              {report.chronology.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground">No chronology entries in this window.</p>
              )}
            </div>
          </Expandable>
          <Expandable title="Anomalies & guidance" icon={<Shield className="h-3.5 w-3.5" />} defaultOpen>
            <div className="space-y-2 p-3">
              {report.anomalies.length === 0 ? (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" /> No material anomalies — see Stability chapter for what went well.
                </p>
              ) : report.anomalies.map((a) => (
                <div key={a.id} className="rounded-md border border-border/40 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-300">{a.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{a.detail}</p>
                  {a.action && <p className="text-[11px] text-primary/80 mt-1">Action: {a.action}</p>}
                  <button className="mt-1 text-[10px] text-primary hover:underline"
                    onClick={() => setDive({ label: a.title, since: a.startUtc, until: a.endUtc, kind: 'samples' })}>
                    Investigate window
                  </button>
                </div>
              ))}
              <div className="pt-2 border-t border-border/20">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1">
                  <Lightbulb className="h-3 w-3" /> Guidance
                </p>
                {report.guidance.map((g, i) => (
                  <p key={i} className="text-[11px] text-muted-foreground leading-relaxed mb-1">
                    <span className="font-medium text-foreground">{g.title}:</span> {g.action}
                  </p>
                ))}
              </div>
            </div>
          </Expandable>
          <Expandable title="Conclusions" icon={<CheckCircle2 className="h-3.5 w-3.5" />} defaultOpen>
            <div className="divide-y divide-border/10">
              {report.conclusions.map((c) => (
                <div key={c.rank} className="px-3 py-2">
                  <p className="text-xs font-semibold">{c.rank}. {c.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{c.detail}</p>
                </div>
              ))}
            </div>
          </Expandable>
        </>
      )}

      {!report && !running && progress.phase === 'idle' && (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm font-medium">No report yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Choose a free time window above and run analysis. The engine will paginate telemetry samples,
            pull overlapping events and runtime context, then produce a full didactic report.
          </p>
          <p className="text-[11px] text-muted-foreground/50 mt-3">
            Prefer watching a live chart? Open <Link to="/admin/diagnostics/telemetry" className="text-primary hover:underline">Monitor</Link>.
          </p>
        </div>
      )}

      {dive && <AnalysisDeepDiveSheet refEvidence={dive} onClose={() => setDive(null)} />}
    </div>
  )
}

function ExecutiveBlock({ report }: { report: TelemetryAnalysisReport }) {
  return (
    <div className={cn('rounded-lg border px-4 py-3', VERDICT_STYLE[report.executive.verdict])}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Executive summary</p>
          <h2 className="text-base font-semibold mt-0.5 leading-snug">{report.executive.headline}</h2>
          <p className="text-xs mt-1.5 leading-relaxed opacity-90">{report.executive.periodSummary}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold tabular-nums">{report.executive.healthScore}</p>
          <p className="text-[10px] uppercase opacity-70">{report.executive.verdict}</p>
        </div>
      </div>
      <p className="text-[10px] mt-2 opacity-60">
        Analyzed {new Date(report.meta.analyzedAt).toLocaleString()} ·{' '}
        {report.meta.coverage.samples} samples
        {report.meta.coverage.truncated ? ' (substrate)' : ''} · {report.meta.coverage.events} events ·{' '}
        sources: {report.meta.coverage.dataSources.join(', ')}
      </p>
    </div>
  )
}

function ChapterCard({ chapter, onDive }: { chapter: AnalysisChapter; onDive: (r: EvidenceRef) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/10">
        {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold">{chapter.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{chapter.summary}</p>
        </div>
      </button>
      {open && (
        <div className="border-t border-border/30 px-3 py-3 space-y-2">
          {chapter.body.map((p, i) => (
            <p key={i} className="text-[12px] leading-relaxed text-foreground/85">{p}</p>
          ))}
          {chapter.evidenceRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {chapter.evidenceRefs.map((r, i) => (
                <button key={i} onClick={() => onDive(r)}
                  className="rounded border border-border/50 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10">
                  Deep dive: {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Expandable({ title, icon, defaultOpen = false, children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/10">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-muted-foreground/60">{icon}</span>
        <span className="text-xs font-semibold">{title}</span>
      </button>
      {open && <div className="border-t border-border/30">{children}</div>}
    </div>
  )
}

function AnalysisDeepDiveSheet({ refEvidence, onClose }: { refEvidence: EvidenceRef; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sampleCount, setSampleCount] = useState(0)
  const [events, setEvents] = useState<DiagnosticsEventRecord[]>([])
  const [preview, setPreview] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const hist = await diagnosticsApi.getSampleHistory({
          since: refEvidence.since,
          until: refEvidence.until,
          limit: 200,
        })
        const samples = telemetryToResourceSamples(hist.items as TelemetrySampleRecord[])
        let ev: DiagnosticsEventRecord[] = []
        try {
          ev = await diagnosticsApi.listEvents({ since: refEvidence.since })
          ev = ev.filter((e) => e.utc <= refEvidence.until && e.name !== 'Telemetry.SampleCollected').slice(0, 40)
        } catch { /* optional */ }
        if (cancelled) return
        setSampleCount(samples.length)
        setEvents(ev)
        const lines: string[] = []
        if (samples.length > 0) {
          const first = samples[0]
          const last = samples[samples.length - 1]
          lines.push(`Machine CPU ${first.cpu ?? '—'}% → ${last.cpu ?? '—'}% · Memory ${first.memoryMb ?? '—'} → ${last.memoryMb ?? '—'} MB`)
          const liveFirst = first.values?.['motor.live']
          const liveLast = last.values?.['motor.live']
          if (liveFirst != null || liveLast != null) {
            lines.push(`Live sessions (overlay) ${liveFirst ?? '—'} → ${liveLast ?? '—'}`)
          }
        }
        for (const e of ev.slice(0, 8)) {
          lines.push(`${new Date(e.utc).toLocaleTimeString()} · ${e.name}`)
        }
        setPreview(lines)
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Deep dive failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [refEvidence])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
          <BookOpen className="h-4 w-4 text-primary/70" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{refEvidence.label}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {new Date(refEvidence.since).toLocaleString()} → {new Date(refEvidence.until).toLocaleString()}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Close</Button>
        </div>
        <div className="px-4 py-3 space-y-2 text-xs">
          {loading && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching scoped evidence…</p>}
          {error && <p className="text-destructive">{error}</p>}
          {!loading && !error && (
            <>
              <p className="text-muted-foreground">
                On-demand fetch: {sampleCount} telemetry sample(s), {events.length} event(s) in this evidence window.
              </p>
              {preview.map((line, i) => (
                <p key={i} className="text-[11px] leading-snug text-foreground/80 border-l-2 border-border/40 pl-2">{line}</p>
              ))}
              <Button asChild variant="outline" size="sm" className="h-7 text-[11px] mt-2">
                <Link to="/admin/diagnostics/timeline">
                  Open timeline
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function round(n: number | null | undefined): string {
  if (n == null) return '—'
  return (Math.round(n * 10) / 10).toLocaleString()
}
