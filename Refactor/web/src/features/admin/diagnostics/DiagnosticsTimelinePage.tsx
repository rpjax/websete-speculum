import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AdminPage, EmptyState, HelperCallout, NextBestAction, PageHeader } from '@/features/admin/components'

export function DiagnosticsTimelinePage() {
  return (
    <AdminPage width="editor">
      <PageHeader
        title="Diagnostics timeline"
        description="Read a narrative of diagnostic evidence for a selected period."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/diagnostics">Diagnostics</Link>
          </Button>
        }
      />
      <HelperCallout title="Available now">This coaching empty state. Timeline data is not available yet.</HelperCallout>
      <HelperCallout title="Coming">Catalogued events and operator-selected scope — not legacy telemetry panels.</HelperCallout>
      <EmptyState
        title="No timeline to read"
        body="Timeline APIs are still expanding. Return when the diagnostics evidence contract is available."
        cta={{ label: 'Back to Diagnostics', href: '/admin/diagnostics' }}
      />
      <NextBestAction
        title="Inspect live sessions"
        body="Live session identity is available today while timeline APIs expand."
        ctaLabel="Open sessions"
        href="/admin/sessions"
      />
    </AdminPage>
  )
}
