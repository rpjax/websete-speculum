import { Link } from 'react-router-dom'
import { Activity, ArrowRight, CheckCircle2, FileCode2, RefreshCw, Server, Settings2, UsersRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { adminJson } from '@/lib/adminFetch'
import { AdminPage, DataCard, EmptyState, HelperCallout, IdChip, MetaRow, NextBestAction, PageHeader, StatCard, StatusPill } from '@/features/admin/components'

type ConfigurationStatus = { operational: boolean; missing: string[] }
type LiveSession = { sessionId: string; profileId: string; connectionOpen: boolean; uptimeMs: number }
type SessionList = { items: LiveSession[] }

const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m` : `${seconds}s`
}

const sections: ReadonlyArray<{ key: string; description: string; href?: string }> = [
  { key: 'Hosting', description: 'Domains, certificates, and edge materialization.' },
  { key: 'Navigation', description: 'Default target and main-frame destination policy.' },
  { key: 'Sessions', description: 'Live-session behavior, viewport, and input policy.' },
  { key: 'ResourceManagement', description: 'Session, profile, diagnostics, and storage limits.' },
  { key: 'Scripting', description: 'Injected script policy and sources.', href: '/w7s/admin/scripts?tab=injections' },
  { key: 'Journal', description: 'Operational fact-log admission and drain settings.' },
  { key: 'Telemetry', description: 'Composite host, session, sidecar, and pipeline sampling.' },
]

const shortcuts = [
  { label: 'Sessions', description: 'Inspect live sessions', href: '/w7s/admin/sessions', icon: Activity },
  { label: 'Profiles', description: 'Persisted browser identities', href: '/w7s/admin/profiles', icon: UsersRound },
  { label: 'Scripts', description: 'Library and page injections', href: '/w7s/admin/scripts', icon: FileCode2 },
  { label: 'Configurations', description: 'Engine sections', href: '/w7s/admin/configurations', icon: Settings2 },
  { label: 'Host resources', description: 'Capacity and shm', href: '/w7s/admin/host-resources', icon: Server },
  { label: 'Health', description: 'Diagnostics runtime overview', href: '/w7s/admin/diagnostics/health', icon: Activity },
]

export function OperatorHomePage() {
  const [status, setStatus] = useState<ConfigurationStatus | null>(null)
  const [sessions, setSessions] = useState<LiveSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      const [nextStatus, nextSessions] = await Promise.all([
        adminJson<ConfigurationStatus>('/api/configurations/status'),
        adminJson<SessionList>('/api/sessions'),
      ])
      setStatus(nextStatus)
      setSessions(nextSessions.items)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load operator status.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  return <AdminPage width="overview" className="space-y-6">
    <PageHeader
      title="Home"
      description="Operator control plane for Speculum."
      actions={<Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Refresh</Button>}
    />
    {error ? <HelperCallout tone="danger" title="Status unavailable">{error}<Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>Retry</Button></HelperCallout> : null}
    {!status && !error ? <Skeleton className="h-64 w-full" /> : null}
    {status && sessions ? <>
      {!status.operational ? <HelperCallout tone="warning" title="Mandatory configuration is incomplete.">Complete the missing sections before starting new sessions.</HelperCallout> : null}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="Operator summary">
        <StatCard label="Status" value={status.operational ? 'Ready' : 'Not ready'} tone={status.operational ? 'success' : 'warning'} icon={<CheckCircle2 className="h-4 w-4" />} sub={status.operational ? 'Ready to start sessions.' : 'Configuration needs attention.'} />
        <StatCard label="Live sessions" value={sessions.length} icon={<Activity className="h-4 w-4" />} sub={<Link to="/w7s/admin/sessions" className="underline">Inspect live sessions</Link>} />
      </section>
      {!status.operational ? <DataCard className="p-4"><div className="space-y-4">
        <div><h2 className="font-semibold">Attention</h2><p className="mt-1 text-sm text-muted-foreground">Open a missing section to continue configuration.</p></div>
        <MetaRow>{status.missing.map((section) => <IdChip key={section} id={section} href={`/w7s/admin/configurations/${encodeURIComponent(section)}`} alwaysShort className="bg-warning/10 text-warning" />)}</MetaRow>
        <NextBestAction title="Continue setup" body="Complete missing sections so sessions can start." ctaLabel="Open setup" href="/w7s/setup" tone="warning" />
      </div></DataCard> : null}
      <section className="grid gap-4 lg:grid-cols-2">
        <DataCard className="p-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Live sessions</h2><p className="mt-1 text-sm text-muted-foreground">Currently attached browser sessions.</p></div><Button asChild size="sm" variant="ghost"><Link to="/w7s/admin/sessions">View all</Link></Button></div>
          {sessions.length ? <div className="mt-4 divide-y divide-border">{sessions.slice(0, 5).map((session) => <div key={session.sessionId} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0 space-y-1"><IdChip id={session.sessionId} href={`/w7s/admin/sessions/${encodeURIComponent(session.sessionId)}`} /><MetaRow><StatusPill label={session.connectionOpen ? 'Open' : 'Closed'} tone={session.connectionOpen ? 'success' : 'neutral'} /><span className="text-xs text-muted-foreground">{formatDuration(session.uptimeMs)}</span></MetaRow></div><Button asChild size="sm" variant="outline"><Link to={`/w7s/admin/sessions/${encodeURIComponent(session.sessionId)}`}>Open</Link></Button></div>)}</div> : <div className="mt-4"><EmptyState title="No live sessions" body="No live sessions — normal when idle." tone="reassure" /></div>}
        </DataCard>
        <DataCard className="p-4">
          <div><h2 className="font-semibold">Engine sections</h2><p className="mt-1 text-sm text-muted-foreground">Open a section to review its current configuration.</p></div>
          <div className="mt-4 divide-y divide-border">{sections.map((section) => { const missing = status.missing.includes(section.key); const href = section.href ?? `/w7s/admin/configurations/${section.key}`; return <div key={section.key} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><Link className="font-medium hover:underline" to={href}>{section.key}</Link><p className="truncate text-xs text-muted-foreground">{section.description}</p></div><div className="flex shrink-0 items-center gap-2"><StatusPill label={missing ? 'Missing' : 'Ready'} tone={missing ? 'warning' : 'success'} /><Button asChild size="icon" variant="ghost" aria-label={`Open ${section.key}`}><Link to={href}><ArrowRight className="h-4 w-4" /></Link></Button></div></div> })}</div>
        </DataCard>
      </section>
      <section><h2 className="mb-3 text-lg font-semibold">Shortcuts</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{shortcuts.map(({ label, description, href, icon: Icon }) => <Link key={href} to={href} className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className="mb-3 h-5 w-5 text-muted-foreground" /><h3 className="font-medium">{label}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></Link>)}</div></section>
    </> : null}
  </AdminPage>
}
