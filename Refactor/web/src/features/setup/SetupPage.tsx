import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_URL } from '@/lib/env'
import { fetchClientConfig, type ClientConfig } from '@/lib/clientConfig'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/admin/PageHeader'

type StepId = 'navigation' | 'sessions' | 'capacity' | 'hosting' | 'done'

const STEPS: { id: StepId; title: string; body: string; href: string; optional?: boolean }[] = [
  {
    id: 'navigation',
    title: 'Navigation',
    body: 'Set the default target host and main-frame allowlist.',
    href: '/admin',
  },
  {
    id: 'sessions',
    title: 'Sessions',
    body: 'Confirm detached timeout and viewport policy.',
    href: '/admin',
  },
  {
    id: 'capacity',
    title: 'Capacity',
    body: 'Set max concurrent sessions under ResourceManagement.',
    href: '/admin',
  },
  {
    id: 'hosting',
    title: 'Hosting',
    body: 'Optional — session domains. Subdomain mirroring ops are 1.1.',
    href: '/admin',
    optional: true,
  },
]

function recommendedStepIndex(config: ClientConfig | null): number {
  if (!config) return 0
  const missing = config.missing
  if (missing.includes('Navigation')) return 0
  if (missing.includes('Sessions')) return 1
  if (missing.includes('ResourceManagement')) return 2
  if (config.operational) return STEPS.length
  return 0
}

export default function SetupPage() {
  const [config, setConfig] = useState<ClientConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    fetchClientConfig(API_URL, true)
      .then(setConfig)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load client config'))
  }, [])

  const current = STEPS[stepIndex] ?? STEPS[0]
  const recommendedIndex = useMemo(() => recommendedStepIndex(config), [config])

  useEffect(() => {
    if (recommendedIndex <= STEPS.length) setStepIndex(recommendedIndex)
  }, [recommendedIndex])

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <PageHeader
        title="Speculum setup"
        description="Mandatory: Navigation, Sessions, and ResourceManagement. Hosting is optional (mirroring ops in 1.1)."
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!config && !error && <Skeleton className="mb-6 h-24 w-full" />}

      {config && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Public client-config readiness</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span>Operational</span>
              <Badge variant={config.operational ? 'success' : 'warning'}>
                {config.operational ? 'yes' : 'no'}
              </Badge>
            </div>
            {config.missing.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Missing: {config.missing.join(', ')}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Default host: {config.navigation.defaultTargetHost || '(unset)'}
            </p>
            {config.hosting.domains.map((d) => (
              <div
                key={d.domain}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{d.domain}</span>
                <Badge variant="muted">
                  {d.subdomainMirroringEnabled ? 'mirroring enabled (1.1)' : 'no mirroring'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <Button
            key={s.id}
            size="sm"
            variant={i === stepIndex ? 'default' : 'outline'}
            onClick={() => setStepIndex(i)}
          >
            {i + 1}. {s.title}
            {s.optional ? ' (opt)' : ''}
          </Button>
        ))}
        <Button
          size="sm"
          variant={stepIndex >= STEPS.length ? 'default' : 'outline'}
          onClick={() => setStepIndex(STEPS.length)}
        >
          Done
        </Button>
      </div>

      {stepIndex < STEPS.length ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Step {stepIndex + 1}: {current.title}
            </CardTitle>
            <CardDescription>{current.body}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/lab?configure=1">Open Lab (apply defaults)</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={current.href}>Admin</Link>
            </Button>
            <Button variant="ghost" onClick={() => setStepIndex((i) => Math.min(i + 1, STEPS.length))}>
              Next
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Ready to browse</CardTitle>
            <CardDescription>
              {config?.operational
                ? 'Mandatory config is satisfied. Open Lab or Live to start a session.'
                : 'Finish missing mandatory sections, then return here.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild><Link to="/lab?configure=1">Open Lab</Link></Button>
            <Button asChild variant="outline"><Link to="/live">Live</Link></Button>
            <Button asChild variant="outline"><Link to="/admin">Admin</Link></Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
