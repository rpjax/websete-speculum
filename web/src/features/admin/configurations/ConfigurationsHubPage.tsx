import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Braces, Settings2 } from 'lucide-react'
import { adminJson } from '@/lib/adminFetch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  PageHeader,
  StatusPill,
} from '@/features/admin/components'

type ConfigStatus = {
  operational: boolean
  missing: string[]
}

const sections = [
  { key: 'Hosting', description: 'Domains, certificates, and edge materialization.' },
  { key: 'Navigation', description: 'Default target and main-frame destination policy.' },
  { key: 'Sessions', description: 'Live-session behavior, viewport, and input policy.' },
  { key: 'ResourceManagement', description: 'Session, profile, diagnostics, and storage limits.' },
  { key: 'Scripting', description: 'Injected script policy and sources.' },
  { key: 'Journal', description: 'Operational fact-log admission and drain settings.' },
  { key: 'Telemetry', description: 'Sampler, front observation, and Journal Telemetry event facts.' },
] as const

export function ConfigurationsHubPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminJson<ConfigStatus>('/api/configurations/status')
      .then(setStatus)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load configuration status.'),
      )
  }, [])

  if (error) {
    return (
      <AdminPage width="overview">
        <PageHeader title="Configurations" description="Manage one engine section at a time." />
        <HelperCallout tone="danger" title="Configuration status is unavailable">
          {error}
        </HelperCallout>
      </AdminPage>
    )
  }

  if (!status) {
    return (
      <AdminPage width="overview">
        <PageHeader title="Configurations" description="Manage one engine section at a time." />
        <EmptyState title="Loading configuration sections" body="Checking the current engine configuration." />
      </AdminPage>
    )
  }

  return (
    <AdminPage width="overview">
      <PageHeader
        title="Configurations"
        description="Manage focused engine sections without mixing unrelated operator decisions."
      />
      {!status.operational ? (
        <HelperCallout tone="warning" title="Configuration needs attention">
          Missing sections: {status.missing.join(', ') || 'unknown'}. Complete them before starting new sessions.
        </HelperCallout>
      ) : (
        <HelperCallout title="Configuration is operational">
          All required engine sections are present. Open a section to review or change it.
        </HelperCallout>
      )}
      <section className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2" aria-label="Engine configuration sections">
        {sections.map((section) => {
          const missing = status.missing.includes(section.key)
          const isScripting = section.key === 'Scripting'
          return (
            <Card key={section.key} className="gap-0 py-0">
              <CardHeader className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Settings2 className="h-4 w-4 shrink-0" />
                      {section.key}
                    </CardTitle>
                    <CardDescription className="mt-1">{section.description}</CardDescription>
                  </div>
                  <StatusPill label={missing ? 'Missing' : 'Ready'} tone={missing ? 'warning' : 'success'} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-muted-foreground">
                  {isScripting ? 'Manage injections in Scripts.' : 'Open the focused section editor.'}
                </span>
                <Button asChild variant={isScripting ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto">
                  <Link
                    to={isScripting ? '/w7s/admin/scripts?tab=injections' : `/w7s/admin/configurations/${section.key}`}
                  >
                    {isScripting ? <Braces className="h-4 w-4" /> : null}
                    {isScripting ? 'Open injections' : 'Open section'}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </section>
    </AdminPage>
  )
}
