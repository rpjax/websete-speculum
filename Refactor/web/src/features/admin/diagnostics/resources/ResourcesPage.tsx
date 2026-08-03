import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  NextBestAction,
  PageHeader,
  RevealPanel,
  StatusPill,
} from '@/features/admin/components'
import { MACHINE_MONITOR_DEFAULT_KEYS } from '@/lib/resourceChartCompute'
import {
  historyToResourceSamples,
  resourceMonitoringApi,
  type ResourceLatestResponse,
  type ResourceSignal,
} from '@/lib/resourceMonitoringApi'
import { AdminApiError } from '@/lib/adminFetch'
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
  const [metricKeys, setMetricKeys] = useState<string[]>([...MACHINE_MONITOR_DEFAULT_KEYS])
  const [live, setLive] = useState(searchParams.get('live') === '1')
  const [latest, setLatest] = useState<ResourceLatestResponse | null>(null)
  const [samples, setSamples] = useState(historyToResourceSamples([]))
  const [signals, setSignals] = useState<ResourceSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
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
      setError(e instanceof AdminApiError ? e.message : 'Could not load resource history')
    } finally {
      setLoading(false)
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
    }, 10_000)
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
        }
      } catch {
        /* ignore missing signal */
      }
    })()
  }, [signalId])

  const activeCount = signals.length
  const telemetryOff = latest && !latest.telemetryEnabled

  const reportHref = useMemo(() => {
    const q = new URLSearchParams({
      step: 'period',
      from: from.toISOString(),
      to: to.toISOString(),
    })
    return `/w7s/admin/diagnostics/reports/new?${q}`
  }, [from, to])

  return (
    <AdminPage width="overview">
      <PageHeader
        title="Resources"
        description="Watch machine and process series from Telemetry samples in Journal."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/w7s/admin/diagnostics/resources/explore?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&metrics=${metricKeys.join(',')}`}>
                Expand
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to={reportHref}>Generate report</Link>
            </Button>
          </div>
        }
      />

      {telemetryOff && (
        <HelperCallout title="Telemetry sampling is off">
          Enable SampleCollected under Telemetry to collect resource series.
        </HelperCallout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {activeCount === 0 ? (
          <StatusPill label="No active signals" tone="success" />
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link to="/w7s/admin/diagnostics/signals">{activeCount} active signals</Link>
          </Button>
        )}
      </div>

      <ResourceSystemStrip latest={latest} />

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
        <div className="flex items-center gap-2 pl-2">
          <Switch id="live" checked={live} onCheckedChange={setLive} />
          <Label htmlFor="live">Live</Label>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
        <MetricOverlayPicker selected={metricKeys} onChange={setMetricKeys} />
      </div>

      {error && (
        <HelperCallout title="Could not load resource history">
          {error}{' '}
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </HelperCallout>
      )}

      {loading ? (
        <div className="h-64 animate-pulse rounded-md border bg-muted/30" />
      ) : samples.length === 0 && !error ? (
        <EmptyState
          title="No samples in this window"
          body={telemetryOff ? 'Enable Telemetry sampling to collect samples.' : 'Widen the time preset or wait for the next sample.'}
          cta={
            telemetryOff
              ? { label: 'Configure Telemetry', href: '/w7s/admin/configurations/Telemetry' }
              : undefined
          }
        />
      ) : (
        <ResourceSeriesChart samples={samples} metricKeys={metricKeys} />
      )}

      <RevealPanel title="Raw samples">
        <div className="max-h-48 overflow-auto text-xs">
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
        </div>
      </RevealPanel>

      <div className="grid gap-3 sm:grid-cols-3">
        {activeCount > 0 && (
          <NextBestAction
            title="Open signals"
            body="Review active leaks and anomalies."
            ctaLabel="Open signals"
            href="/w7s/admin/diagnostics/signals"
          />
        )}
        <NextBestAction
          title="Generate report for this window"
          body="Materialize a Journal-backed report."
          ctaLabel="Generate report"
          href={reportHref}
        />
        <NextBestAction
          title="Host resources"
          body="Capacity and shm provisioning."
          ctaLabel="Host resources"
          href="/w7s/admin/host-resources"
        />
      </div>
    </AdminPage>
  )
}
