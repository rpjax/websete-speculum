import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ConfigStatus } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/admin/PageHeader'
import { profileBadge } from '@/lib/hostingStatus'

type StepId = 'hosting' | 'forwarding' | 'capacity' | 'done'

const STEPS: { id: StepId; title: string; body: string; href: string }[] = [
  {
    id: 'hosting',
    title: 'Hosting',
    body: 'Add the motor domain, TLS email, and optional mirroring.',
    href: '/admin/hosting',
  },
  {
    id: 'forwarding',
    title: 'Forwarding',
    body: 'Set the target site host and navigation allowlist.',
    href: '/admin/forwarding',
  },
  {
    id: 'capacity',
    title: 'Capacity',
    body: 'Confirm concurrent session limits and retention policy.',
    href: '/admin/capacity',
  },
]

export default function SetupPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    api.getStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load status'))
  }, [])

  const current = STEPS[stepIndex] ?? STEPS[0]

  const recommendedIndex = useMemo(() => {
    if (!status) return 0
    const missing = status.missing
    if (missing.includes('Hosting') || (status.hosting?.profiles.length ?? 0) === 0) return 0
    if (missing.includes('Forwarding')) return 1
    if (missing.includes('MaxSessions')) return 2
    return 3
  }, [status])

  useEffect(() => {
    if (recommendedIndex < STEPS.length) setStepIndex(recommendedIndex)
  }, [recommendedIndex])

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <PageHeader
        title="Speculum setup"
        description="Guided first-run — one job per step. Sign in to Admin to apply each configuration."
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!status && !error && <Skeleton className="mb-6 h-24 w-full" />}

      {status && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Public motor readiness</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span>Operational</span>
              <Badge variant={status.operational ? 'success' : 'warning'}>
                {status.operational ? 'yes' : 'no'}
              </Badge>
            </div>
            {(status.hosting?.profiles ?? []).map((p) => {
              const b = profileBadge(p)
              return (
                <div key={p.domain} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span>{p.domain}</span>
                  <Badge variant={b.tone}>{b.label}</Badge>
                </div>
              )
            })}
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
              <Link to="/admin/login">Sign in &amp; configure</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={current.href}>Open {current.title}</Link>
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
              {status?.operational
                ? 'Motor reports operational. Open the Motor surface to start a session.'
                : 'Finish missing sections in Admin, then return here.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild><Link to="/">Open Motor</Link></Button>
            <Button asChild variant="outline"><Link to="/admin">Admin dashboard</Link></Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
