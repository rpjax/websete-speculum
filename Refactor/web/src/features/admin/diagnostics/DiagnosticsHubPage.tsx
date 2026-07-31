import { Activity, SearchCheck, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AdminPage,
  HelperCallout,
  NextBestAction,
  PageHeader,
} from '@/features/admin/components'

const jobs = [
  {
    title: 'Observe',
    description: 'Review the available health surface and understand what the service reports today.',
    available: 'Honest availability explanation for the health contract.',
    coming: 'Runtime overview API and health snapshots.',
    href: '/admin/diagnostics/health',
    icon: Activity,
    action: 'View health',
  },
  {
    title: 'Investigate',
    description: 'Open the timeline or investigation workspace when diagnostic APIs are available.',
    available: 'Coaching empty states for timeline and investigate routes.',
    coming: 'Evidence timeline and investigation APIs.',
    href: '/admin/diagnostics/timeline',
    icon: SearchCheck,
    action: 'Open timeline',
  },
  {
    title: 'Govern',
    description: 'Review capability and recovery controls without changing runtime state here.',
    available: 'Governance route with honest empty coaching.',
    coming: 'Capability toggles and recover/elevate contracts.',
    href: '/admin/diagnostics/governance',
    icon: ShieldCheck,
    action: 'Open governance',
  },
]

export function DiagnosticsHubPage() {
  return (
    <AdminPage width="overview">
      <PageHeader
        title="Diagnostics"
        description="Choose the operator job: observe the platform, investigate evidence, or govern observability."
      />
      <HelperCallout title="Diagnostic surfaces are expanding">
        Pages below stay honest until their APIs ship — no fake charts or ported legacy monitors.
      </HelperCallout>
      <section className="grid gap-4 lg:grid-cols-3" aria-label="Diagnostics jobs">
        {jobs.map((job) => {
          const Icon = job.icon
          return (
            <Card key={job.title}>
              <CardHeader>
                <Icon className="h-5 w-5 text-primary" />
                <CardTitle className="mt-2">{job.title}</CardTitle>
                <CardDescription>{job.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">Available now:</span> {job.available}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">Coming:</span> {job.coming}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link to={job.href}>{job.action}</Link>
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <NextBestAction
          title="Configure Telemetry"
          body="Sampler cadence and sample sections are available in Configurations."
          ctaLabel="Open Telemetry"
          href="/admin/configurations/Telemetry"
        />
        <NextBestAction
          title="Host resources"
          body="Review capacity and shared memory when investigating host pressure."
          ctaLabel="Open host resources"
          href="/admin/host-resources"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Need the investigate workspace directly?{' '}
        <Link className="underline" to="/admin/diagnostics/investigate">
          Open investigate
        </Link>
        .
      </p>
    </AdminPage>
  )
}
