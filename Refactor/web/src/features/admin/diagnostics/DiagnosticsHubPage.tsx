import { Activity, FileBarChart2, LineChart, SearchCheck, ShieldCheck, Siren } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AdminPage,
  HelperCallout,
  NextBestAction,
  PageHeader,
} from '@/features/admin/components'

const observe = [
  {
    title: 'Health',
    description: 'Runtime overview for Diagnostics capabilities and degraded state.',
    href: '/w7s/admin/diagnostics/health',
    icon: Activity,
    action: 'View health',
  },
  {
    title: 'Resources',
    description: 'Live strip and CPU / memory / disk series from Telemetry samples.',
    href: '/w7s/admin/diagnostics/resources',
    icon: LineChart,
    action: 'Watch resources',
  },
  {
    title: 'Signals',
    description: 'Active leaks and resource anomalies detected server-side.',
    href: '/w7s/admin/diagnostics/signals',
    icon: Siren,
    action: 'Open signals',
  },
]

const investigate = [
  {
    title: 'Journal',
    description: 'Durable diagnostic facts from the Journal — filter, correlate, inspect payloads.',
    href: '/w7s/admin/diagnostics/timeline',
    icon: SearchCheck,
    action: 'Open journal',
  },
  {
    title: 'Reports',
    description: 'Materialized Journal windows for trends, leaks, and Journal health.',
    href: '/w7s/admin/diagnostics/reports',
    icon: FileBarChart2,
    action: 'Open reports',
  },
]

export function DiagnosticsHubPage() {
  return (
    <AdminPage width="overview">
      <PageHeader
        title="Diagnostics"
        description="Choose the operator job: observe the platform, investigate evidence, or govern observability."
      />
      <HelperCallout title="Resources charts and signals">
        Resources charts and signals use Telemetry samples in Journal. Enable sampling under Telemetry if the watch surfaces are empty.
      </HelperCallout>

      <section className="space-y-2" aria-label="Observe">
        <h2 className="text-sm font-medium text-muted-foreground">Observe</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {observe.map((job) => {
            const Icon = job.icon
            return (
              <Card key={job.title}>
                <CardHeader>
                  <Icon className="h-5 w-5 text-primary" />
                  <CardTitle className="mt-2">{job.title}</CardTitle>
                  <CardDescription>{job.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" size="sm">
                    <Link to={job.href}>{job.action}</Link>
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="space-y-2" aria-label="Investigate">
        <h2 className="text-sm font-medium text-muted-foreground">Investigate</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {investigate.map((job) => {
            const Icon = job.icon
            return (
              <Card key={job.title}>
                <CardHeader>
                  <Icon className="h-5 w-5 text-primary" />
                  <CardTitle className="mt-2">{job.title}</CardTitle>
                  <CardDescription>{job.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" size="sm">
                    <Link to={job.href}>{job.action}</Link>
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="space-y-2" aria-label="Govern">
        <h2 className="text-sm font-medium text-muted-foreground">Govern</h2>
        <Card>
          <CardHeader>
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle className="mt-2">Governance</CardTitle>
            <CardDescription>
              Review capability and recovery controls without changing runtime state here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/w7s/admin/diagnostics/governance">Open governance</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <NextBestAction
          title="Configure Telemetry"
          body="Sampler cadence and sample sections are available in Configurations."
          ctaLabel="Configure Telemetry"
          href="/w7s/admin/configurations/Telemetry"
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
