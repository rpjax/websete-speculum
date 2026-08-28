import { AdminPage, EmptyState, HelperCallout, NextBestAction, PageHeader } from '@/features/admin/components'

export function DiagnosticsGovernancePage() {
  return (
    <AdminPage width="editor">
      <PageHeader
        title="Governance"
        description="Govern diagnostic capabilities, budgets, and recovery when the runtime contracts are available."
      />
      <HelperCallout title="Available now">
        This route explains that governance controls are not connected yet. It intentionally does not expose unverified toggles.
      </HelperCallout>
      <HelperCallout title="Coming">Configured versus effective capabilities and explicit recovery proof.</HelperCallout>
      <EmptyState
        title="Governance API is expanding"
        body="Configuration remains available through its focused sections while diagnostics governance endpoints are completed."
        cta={{ label: 'Open Telemetry', href: '/w7s/admin/configurations/Telemetry' }}
      />
      <NextBestAction
        title="Configure Telemetry"
        body="Sampler and sample-section toggles live under Configurations today."
        ctaLabel="Open Telemetry"
        href="/w7s/admin/configurations/Telemetry"
      />
    </AdminPage>
  )
}
