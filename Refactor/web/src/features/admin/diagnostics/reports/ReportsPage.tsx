import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  PageHeader,
  StatusPill,
} from '@/features/admin/components'
import { resourceMonitoringApi, type ResourceReport } from '@/lib/resourceMonitoringApi'

const KIND_LABELS: Record<string, string> = {
  resourceTrend: 'Resource trend',
  leakSuspect: 'Leak suspect',
  saturationWindow: 'Saturation window',
  journalHealth: 'Journal health',
}

function statusTone(s: string): 'info' | 'warning' | 'danger' | 'success' | 'neutral' {
  if (s === 'ready') return 'success'
  if (s === 'failed') return 'danger'
  if (s === 'pending') return 'warning'
  return 'neutral'
}

export function ReportsPage() {
  const [items, setItems] = useState<ResourceReport[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await resourceMonitoringApi.reports()
        setItems(res.items)
      } catch {
        setError('Could not load reports')
      }
    })()
  }, [])

  return (
    <AdminPage>
      <PageHeader
        title="Reports"
        description="Materialized Journal windows for trends, leaks, saturation, and Journal health."
        actions={
          <Button asChild size="sm">
            <Link to="/w7s/admin/diagnostics/reports/new">Generate report</Link>
          </Button>
        }
      />
      <HelperCallout title="Materialized artifacts">
        Reports are materialized from Telemetry samples in Journal — not live charts.
      </HelperCallout>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {items.length === 0 && !error ? (
        <EmptyState
          title="No reports yet"
          body="Generate a report from a time window of Telemetry samples."
          cta={{ label: 'Generate report', href: '/w7s/admin/diagnostics/reports/new' }}
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                to={`/w7s/admin/diagnostics/reports/${r.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium">{KIND_LABELS[r.kind] ?? r.kind}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.from).toLocaleString()} → {new Date(r.to).toLocaleString()}
                  </div>
                </div>
                <StatusPill label={r.status} tone={statusTone(r.status)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminPage>
  )
}
