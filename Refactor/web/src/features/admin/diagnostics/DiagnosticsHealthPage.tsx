import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  NextBestAction,
  PageHeader,
} from '@/features/admin/components'

export function DiagnosticsHealthPage() {
  return (
    <AdminPage width="editor">
      <PageHeader
        title="Diagnostics health"
        description="Observe the runtime health contract as it becomes available."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/diagnostics">Diagnostics</Link>
          </Button>
        }
      />
      <HelperCallout title="Available now">
        This explanation. Health APIs are expanding — this screen does not invent metrics or port legacy monitors.
      </HelperCallout>
      <HelperCallout title="Coming">
        Runtime overview API and health snapshots once the diagnostics contract is published.
      </HelperCallout>
      <EmptyState
        title="No health snapshot is available yet"
        body="Use configuration and session surfaces for current operator work; return here when the health API is published."
        cta={{ label: 'Back to Diagnostics', href: '/admin/diagnostics' }}
      />
      <NextBestAction
        title="Configure Telemetry"
        body="Composite sampling is configured under Telemetry — not fabricated here."
        ctaLabel="Open Telemetry"
        href="/admin/configurations/Telemetry"
      />
    </AdminPage>
  )
}
