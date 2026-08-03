import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AdminPage, PageHeader } from '@/features/admin/components'
import { MACHINE_MONITOR_DEFAULT_KEYS } from '@/lib/resourceChartCompute'
import {
  historyToResourceSamples,
  resourceMonitoringApi,
} from '@/lib/resourceMonitoringApi'
import { useEffect } from 'react'
import { MetricOverlayPicker } from './MetricOverlayPicker'
import { ResourceSeriesChart } from './ResourceSeriesChart'

export function ResourcesExplorePage() {
  const [params] = useSearchParams()
  const from = params.get('from') ?? new Date(Date.now() - 3600_000).toISOString()
  const to = params.get('to') ?? new Date().toISOString()
  const initialMetrics = (params.get('metrics')?.split(',').filter(Boolean) ?? [
    ...MACHINE_MONITOR_DEFAULT_KEYS,
  ]) as string[]
  const [metricKeys, setMetricKeys] = useState(initialMetrics)
  const [samples, setSamples] = useState(historyToResourceSamples([]))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const hist = await resourceMonitoringApi.history({ from, to, limit: 1000 })
        setSamples(historyToResourceSamples(hist.items))
        setError(null)
      } catch {
        setError('Could not load resource history')
      }
    })()
  }, [from, to])

  const backHref = useMemo(() => {
    const q = new URLSearchParams({ from, to })
    return `/w7s/admin/diagnostics/resources?${q}`
  }, [from, to])

  return (
    <AdminPage width="overview">
      <PageHeader
        title="Resources explore"
        description="Advanced series views for the selected window."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={backHref}>Back to Resources</Link>
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <MetricOverlayPicker selected={metricKeys} onChange={setMetricKeys} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ResourceSeriesChart samples={samples} metricKeys={metricKeys} height={420} />
    </AdminPage>
  )
}
