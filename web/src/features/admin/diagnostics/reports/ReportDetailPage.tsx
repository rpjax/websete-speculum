import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  PageHeader,
  RevealPanel,
  StatusPill,
} from '@/features/admin/components'
import { resourceMonitoringApi, type ResourceReport } from '@/lib/resourceMonitoringApi'

export function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>()
  const [report, setReport] = useState<ResourceReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!reportId) return
    let cancelled = false
    const poll = async () => {
      try {
        const r = await resourceMonitoringApi.report(reportId)
        if (!cancelled) setReport(r)
        if (r.status === 'pending') window.setTimeout(() => void poll(), 2000)
      } catch {
        if (!cancelled) setError('Report not found')
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [reportId])

  if (error) {
    return (
      <AdminPage>
        <EmptyState title="Report not found" body={error} cta={{ label: 'Back to reports', href: '/w7s/admin/diagnostics/reports' }} />
      </AdminPage>
    )
  }

  if (!report) {
    return (
      <AdminPage>
        <div className="h-40 animate-pulse rounded-md border bg-muted/30" />
      </AdminPage>
    )
  }

  return (
    <AdminPage>
      <PageHeader
        title={report.kind}
        description={report.summary || undefined}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/w7s/admin/diagnostics/reports">Back to reports</Link>
          </Button>
        }
      />
      <StatusPill label={report.status} tone={report.status === 'ready' ? 'success' : report.status === 'failed' ? 'danger' : 'warning'} />

      {report.status === 'pending' && (
        <HelperCallout title="Materializing…">Materializing report from Journal samples…</HelperCallout>
      )}

      {report.status === 'failed' && report.error && (
        <HelperCallout title="Report failed">
          {report.error.errorCode} · phase {report.error.phase}
        </HelperCallout>
      )}

      {report.status === 'ready' && (
        <div className="space-y-6">
          {report.chapters.map((ch) => (
            <section key={ch.title} className="space-y-2">
              <h2 className="text-lg font-medium">{ch.title}</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ch.body}</p>
              {ch.seriesSummary && (
                <RevealPanel title="Series snapshot">
                  <ul className="text-xs space-y-1">
                    {Object.entries(ch.seriesSummary).map(([k, v]) => (
                      <li key={k}>
                        {k}: min {v.min ?? '—'} · avg {v.avg ?? '—'} · max {v.max ?? '—'} · last {v.last ?? '—'}
                      </li>
                    ))}
                  </ul>
                </RevealPanel>
              )}
            </section>
          ))}
          <Button asChild variant="outline">
            <Link to={`/w7s/admin/diagnostics/resources?from=${encodeURIComponent(report.from)}&to=${encodeURIComponent(report.to)}`}>
              Open this window in Resources
            </Link>
          </Button>
        </div>
      )}
    </AdminPage>
  )
}
