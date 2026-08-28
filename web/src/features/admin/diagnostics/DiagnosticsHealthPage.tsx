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
        title="Health"
        description="Observe the runtime health contract as it becomes available."
      />
      <HelperCallout title="Available now">
        This explanation. Health APIs are expanding — this screen does not invent metrics or port legacy monitors.
      </HelperCallout>
      <HelperCallout title="Coming">
        Runtime overview API and health snapshots once the diagnostics contract is published.
      </HelperCallout>
      <EmptyState
        title="No health snapshot is available yet"
        body="Use Resources for live samples, or configure Telemetry when the watch surfaces are empty."
        cta={{ label: 'Watch resources', href: '/w7s/admin/diagnostics/resources' }}
      />
      <NextBestAction
        title="Configure Telemetry"
        body="Composite sampling is configured under Telemetry — not fabricated here."
        ctaLabel="Open Telemetry"
        href="/w7s/admin/configurations/Telemetry"
      />
    </AdminPage>
  )
}
