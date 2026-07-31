import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AdminPage, EmptyState, HelperCallout, NextBestAction, PageHeader } from '@/features/admin/components'

export function DiagnosticsInvestigatePage() {
  return (
    <AdminPage width="editor">
      <PageHeader
        title="Investigate diagnostics"
        description="Resolve an operator question with scoped evidence and probes."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/diagnostics">Diagnostics</Link>
          </Button>
        }
      />
      <HelperCallout title="Available now">
        This honest placeholder. Probe, resolve, and evidence APIs have not been published for this Admin route.
      </HelperCallout>
      <HelperCallout title="Coming">Scoped investigation with catalogued evidence — no simulated diagnostic truth.</HelperCallout>
      <EmptyState
        title="Investigation is not available yet"
        body="When APIs arrive, start with a scope and period, then inspect catalogued evidence."
        cta={{ label: 'Back to Diagnostics', href: '/admin/diagnostics' }}
      />
      <NextBestAction
        title="Host resources"
        body="Capacity and shared memory are available while investigation contracts expand."
        ctaLabel="Open host resources"
        href="/admin/host-resources"
      />
    </AdminPage>
  )
}
