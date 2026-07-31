import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AdminPage, EmptyState, HelperCallout, NextBestAction, PageHeader } from '@/features/admin/components'

export function DiagnosticsGovernancePage() {
  return (
    <AdminPage width="editor">
      <PageHeader
        title="Diagnostics governance"
        description="Govern diagnostic capabilities, budgets, and recovery when the runtime contracts are available."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/diagnostics">Diagnostics</Link>
          </Button>
        }
      />
      <HelperCallout title="Available now">
        This route explains that governance controls are not connected yet. It intentionally does not expose unverified toggles.
      </HelperCallout>
      <HelperCallout title="Coming">Configured versus effective capabilities and explicit recovery proof.</HelperCallout>
      <EmptyState
        title="Governance API is expanding"
        body="Configuration remains available through its focused sections while diagnostics governance endpoints are completed."
        cta={{ label: 'Back to Diagnostics', href: '/admin/diagnostics' }}
      />
      <NextBestAction
        title="Configure Telemetry"
        body="Sampler and sample-section toggles live under Configurations today."
        ctaLabel="Open Telemetry"
        href="/admin/configurations/Telemetry"
      />
    </AdminPage>
  )
}
