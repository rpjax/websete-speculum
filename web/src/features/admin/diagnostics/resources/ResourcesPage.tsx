import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  PageHeader,
  RevealPanel,
  StatusPill,
} from '@/features/admin/components'
import {
  historyToResourceSamples,
  resourceMonitoringApi,
  type ResourceLatestResponse,
  type ResourceSignal,
} from '@/lib/resourceMonitoringApi'
import { AdminApiError } from '@/lib/adminFetch'
import { api, ConfigSections } from '@/lib/api'
import {
  applyTelemetryPreset,
  TELEMETRY_PRESETS,
  type JsonObject,
} from '@/features/admin/configurations/telemetryHelpers'
import { MetricOverlayPicker } from './MetricOverlayPicker'
import { ResourceSeriesChart } from './ResourceSeriesChart'
import { ResourceSystemStrip } from './ResourceSystemStrip'

type Preset = '15m' | '1h' | '6h' | '24h'

function windowForPreset(preset: Preset): { from: Date; to: Date } {
  const to = new Date()
  const ms =
    preset === '15m' ? 15 * 60_000 :
    preset === '1h' ? 60 * 60_000 :
    preset === '6h' ? 6 * 60 * 60_000 :
    24 * 60 * 60_000
  return { from: new Date(to.getTime() - ms), to }
}

export function ResourcesPage() {
  const [searchParams] = useSearchParams()
  const signalId = searchParams.get('signalId')
  const [preset, setPreset] = useState<Preset>('1h')
  const [from, setFrom] = useState(() => windowForPreset('1h').from)
  const [to, setTo] = useState(() => windowForPreset('1h').to)
  const [metricKeys, setMetricKeys] = useState<string[]>(['host.cpu', 'host.memory'])
  const [live, setLive] = useState(searchParams.get('live') !== '0')
  const [latest, setLatest] = useState<ResourceLatestResponse | null>(null)
  const [samples, setSamples] = useState(historyToResourceSamples([]))
  const [signals, setSignals] = useState<ResourceSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setError(null)
    setRefreshing(true)
    try {
      const [lat, hist, sig] = await Promise.all([
        resourceMonitoringApi.latest(),
        resourceMonitoringApi.history({
          from: from.toISOString(),
          to: to.toISOString(),
          limit: 500,
        }),
        resourceMonitoringApi.signals({ status: 'active' }),
      ])
      setLatest(lat)
      setSamples(historyToResourceSamples(hist.items))
      setSignals(sig.items)
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Could not load resources')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => {
      const w = windowForPreset(preset)
      setFrom(w.from)
      setTo(w.to)
    }, 8_000)
    return () => window.clearInterval(id)
  }, [live, preset])

  useEffect(() => {
    if (!signalId) return
    void (async () => {
      try {
        const signal = await resourceMonitoringApi.signal(signalId)
        if (signal.chartHint) {
          setFrom(new Date(signal.chartHint.from))
          setTo(new Date(signal.chartHint.to))
          if (signal.chartHint.metricKeys?.length)
            setMetricKeys(signal.chartHint.metricKeys)
          setLive(false)
        }
      } catch {
        /* ignore missing signal */
      }
    })()
  }, [signalId])

  const activeCount = signals.length
  const historyOff = latest != null && !latest.telemetryEnabled
  const historyTone = latest == null ? 'neutral' : historyOff ? 'warning' : 'success'
  const historyLabel =
    latest == null ? 'History…' : historyOff ? 'History sampling off' : 'History sampling on'

  const reportHref = useMemo(() => {
    const q = new URLSearchParams({
      step: 'period',
      from: from.toISOString(),
      to: to.toISOString(),
    })
    return `/w7s/admin/diagnostics/reports/new?${q}`
  }, [from, to])

  const exploreHref = useMemo(
    () =>
      `/w7s/admin/diagnostics/resources/explore?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&metrics=${metricKeys.join(',')}`,
    [from, to, metricKeys],
  )

  async function startHistoryCollection() {
    setEnabling(true)
    setEnableError(null)
    try {
      const current = (await api.getSection(ConfigSections.Telemetry)) as JsonObject
      const lean = TELEMETRY_PRESETS.find((p) => p.id === 'lean')
      if (!lean) throw new Error('Lean preset missing')
      const next = applyTelemetryPreset(current, lean)
      await api.putSection(ConfigSections.Telemetry, next)
      await load()
    } catch (e) {
      setEnableError(e instanceof Error ? e.message : 'Could not enable Telemetry sampling')
    } finally {
      setEnabling(false)
    }
  }

  return (
    <AdminPage width="overview">
      <PageHeader
        title="Resources"
        description="Live machine probe now. Journal SampleCollected series for the past."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5">
              <Switch id="live" checked={live} onCheckedChange={setLive} />
              <Label htmlFor="live" className="text-xs font-medium">
                Live
              </Label>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill
          label={live ? 'Auto-refresh on' : 'Paused'}
          tone={live ? 'success' : 'neutral'}
        />
        <StatusPill label={historyLabel} tone={historyTone} />
        {activeCount === 0 ? (
          <StatusPill label="No active signals" tone="success" />
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link to="/w7s/admin/diagnostics/signals">{activeCount} active signals</Link>
          </Button>
        )}
      </div>

      {error && (
        <HelperCallout tone="danger" title="Could not load resources">
          {error}{' '}
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </HelperCallout>
      )}

      <section className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-primary">Now</h2>
          <p className="text-[11px] text-muted-foreground">
            On-demand probe — works even when history sampling is off
          </p>
        </div>
        {loading && !latest ? (
          <div className="h-40 animate-pulse rounded-md border bg-muted/30" />
        ) : (
          <ResourceSystemStrip latest={latest} refreshing={refreshing} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-primary">History</h2>
            <p className="text-[11px] text-muted-foreground">
              Series from Journal SampleCollected in this window
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['15m', '1h', '6h', '24h'] as Preset[]).map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={preset === p ? 'default' : 'outline'}
                onClick={() => {
                  setPreset(p)
                  const w = windowForPreset(p)
                  setFrom(w.from)
                  setTo(w.to)
                }}
              >
                {p}
              </Button>
            ))}
            <MetricOverlayPicker selected={metricKeys} onChange={setMetricKeys} />
          </div>
        </div>

        {historyOff && samples.length === 0 && (
          <HelperCallout tone="warning" title="History needs the Telemetry sampler">
            Live probe above still works. Turn on Lean sampling to record CPU / RAM / disk over time.
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={enabling}
                onClick={() => void startHistoryCollection()}
              >
                {enabling ? 'Starting…' : 'Start Lean sampling'}
              </Button>
              <Button asChild type="button" size="sm" variant="outline">
                <Link to="/w7s/admin/configurations/Telemetry">Open Telemetry</Link>
              </Button>
            </div>
            {enableError ? <p className="mt-2 text-xs text-destructive">{enableError}</p> : null}
          </HelperCallout>
        )}

        {historyOff && samples.length > 0 && (
          <HelperCallout tone="warning" title="Sampling paused — showing journaled past">
            Chart below is older SampleCollected data. Resume Lean sampling to keep filling this window.
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={enabling}
                onClick={() => void startHistoryCollection()}
              >
                {enabling ? 'Starting…' : 'Resume Lean sampling'}
              </Button>
              <Button asChild type="button" size="sm" variant="outline">
                <Link to="/w7s/admin/configurations/Telemetry">Open Telemetry</Link>
              </Button>
            </div>
            {enableError ? <p className="mt-2 text-xs text-destructive">{enableError}</p> : null}
          </HelperCallout>
        )}

        {loading ? (
          <div className="h-64 animate-pulse rounded-md border bg-muted/30" />
        ) : samples.length === 0 && !error ? (
          <EmptyState
            title="No samples in this window"
            body={
              historyOff
                ? 'Start Lean sampling to fill this chart, or widen the window after it has been collecting.'
                : 'Widen the time preset or wait for the next SampleCollected.'
            }
            cta={
              historyOff
                ? undefined
                : { label: 'Open Journal', href: '/w7s/admin/diagnostics/timeline' }
            }
          />
        ) : (
          <ResourceSeriesChart samples={samples} metricKeys={metricKeys} />
        )}

        <RevealPanel title="Raw samples">
          <div className="max-h-48 overflow-auto text-xs">
            {samples.length === 0 ? (
              <p className="text-muted-foreground">No rows in this window.</p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1 pr-2">Time</th>
                    <th className="py-1 pr-2">CPU</th>
                    <th className="py-1 pr-2">Mem MB</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.slice(-25).reverse().map((s) => (
                    <tr key={s.utc + s.timestamp} className="border-b border-border/50">
                      <td className="py-1 pr-2">{new Date(s.utc).toLocaleTimeString()}</td>
                      <td className="py-1 pr-2">{s.cpu ?? '—'}</td>
                      <td className="py-1 pr-2">{s.memoryMb ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </RevealPanel>

        <RevealPanel title="More actions">
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={exploreHref}>Expand chart</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={reportHref}>Generate report</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/w7s/admin/host-resources">Host resources (capacity)</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/w7s/admin/configurations/Telemetry">Telemetry config</Link>
            </Button>
          </div>
        </RevealPanel>
      </section>
    </AdminPage>
  )
}
