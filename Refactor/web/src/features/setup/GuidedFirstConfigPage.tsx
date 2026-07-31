import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { adminJson } from '@/lib/adminFetch'
import { getAdminAuth } from '@/lib/adminAuth'
import { fetchClientConfig } from '@/lib/clientConfig'
import { GuidedPreset, HelperCallout, PageHeader, RevealPanel, SaveFeedback, StepWizard } from '@/features/admin/components'
import { MainFrameAllowlistEditor } from '@/features/admin/configurations/MainFrameAllowlistEditor'
import { isBareHost } from '@/features/admin/configurations/urlMatchRules'

type Section = 'Navigation' | 'Sessions' | 'ResourceManagement'
type Status = { operational: boolean; missing: string[] }
const mandatory: Section[] = ['Navigation', 'Sessions', 'ResourceManagement']
const sessionsBaseline = {
  detachedSessionTimeout: '00:30:00', isJsBridgeEnabled: true,
  viewportPolicy: { minimum: { width: 100, height: 100 }, default: { width: 1280, height: 720 }, maximum: { width: 4096, height: 2160 } },
  clientEnvironmentPolicy: { defaultLocale: 'en-US', defaultLanguage: 'en-US', defaultTimeZoneId: 'UTC', defaultColorScheme: 'light' },
  deviceEmulationPolicy: { default: { mobile: false, touch: false, deviceScaleFactor: 1, maxTouchPoints: 0, userAgentProfile: 'desktop', screenOrientation: 'landscapePrimary' }, minDeviceScaleFactor: 1, maxDeviceScaleFactor: 2, maxTouchPoints: 10, defaultTouchPointsWhenTouch: 5, desktopUserAgentProfile: 'desktop', mobileUserAgentProfile: 'mobile' },
  inputMultiplexingPolicy: { access: 'shared', ownership: 'firstAttached', scheduling: 'arrivalOrder' },
  outputMultiplexingPolicy: { delivery: 'broadcast', ownership: 'firstAttached' },
}

export function GuidedFirstConfigPage() {
  const [queue, setQueue] = useState<Section[] | null>(null)
  const [index, setIndex] = useState(0)
  const [sectionValue, setSectionValue] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const current = queue?.[index]

  const loadStatus = useCallback(async () => {
    const config = await fetchClientConfig('', true)
    setQueue(config.missing.filter((name): name is Section => mandatory.includes(name as Section)))
  }, [])
  useEffect(() => { loadStatus().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load setup status.')) }, [loadStatus])
  useEffect(() => {
    if (!current) return
    setLoading(true); setError(null); setSectionValue(null)
    adminJson<Record<string, unknown>>(`/api/configurations/${current}`).then(setSectionValue).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : `Unable to load ${current}.`)).finally(() => setLoading(false))
  }, [current])

  if (queue && queue.length === 0 && !complete) return <Navigate to="/admin" replace />
  if (complete) return <main className="mx-auto max-w-2xl px-6 py-12"><PageHeader title="Setup complete" /><Card className="mt-6"><CardHeader><CardTitle>Setup complete</CardTitle><CardDescription>Mandatory configuration is valid and sessions can start.</CardDescription></CardHeader><CardContent><Button asChild><Link to="/admin">Go to Home</Link></Button></CardContent></Card></main>
  if (!queue || !current) return <main className="mx-auto max-w-2xl px-6 py-12"><PageHeader title="Setup" /><Skeleton className="mt-6 h-64 w-full" /></main>

  const update = (patch: Record<string, unknown>) => setSectionValue((value) => ({ ...(value ?? {}), ...patch }))
  const apply = async () => {
    if (!getAdminAuth()) { window.location.assign('/admin/login?returnUrl=%2Fsetup%2Fconfigure'); return }
    if (!sectionValue) return
    setPending(true); setError(null)
    try {
      await adminJson(`/api/configurations/${current}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sectionValue) })
      const status = await adminJson<Status>('/api/configurations/status')
      if (status.missing.includes(current)) throw new Error(`${current} remains incomplete. Check the required fields and try again.`)
      if (status.operational) { setComplete(true); return }
      const next = status.missing.filter((name): name is Section => mandatory.includes(name as Section))
      setQueue(next)
      setIndex(0)
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Unable to apply ${current}.`) } finally { setPending(false) }
  }
  const timeout = String(sectionValue?.detachedSessionTimeout ?? '')
  const maxSessions = Number((sectionValue?.sessions as Record<string, unknown> | undefined)?.maxConcurrentSessions ?? 10)
  const host = String(sectionValue?.defaultTargetHost ?? '')
  const canApply = current === 'Navigation' ? isBareHost(host) : current === 'Sessions' ? timeout.length > 0 && Number(timeout.slice(0, 2)) + Number(timeout.slice(3, 5)) + Number(timeout.slice(6, 8)) > 0 && Boolean(sectionValue?.viewportPolicy) && Boolean(sectionValue?.clientEnvironmentPolicy) && Boolean(sectionValue?.deviceEmulationPolicy) : maxSessions >= 1

  return <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
    <PageHeader title="Setup" description="Configure the missing mandatory sections." />
    <StepWizard steps={queue.map((section) => ({ id: section, title: section }))} currentIndex={index} onBack={index ? () => setIndex(index - 1) : undefined} onContinue={apply} continueDisabled={!canApply || pending || loading} continueLabel={pending ? 'Applying…' : 'Apply and continue'}>
      {loading ? <Skeleton className="h-64 w-full" /> : <Card><CardHeader><CardTitle>{current}</CardTitle><CardDescription>Step {index + 1} of {queue.length}</CardDescription></CardHeader><CardContent className="space-y-5">
        {current === 'Navigation' ? <NavigationFields host={host} value={sectionValue ?? {}} onChange={update} /> : null}
        {current === 'Sessions' ? <SessionsFields timeout={timeout} value={sectionValue ?? {}} onChange={update} /> : null}
        {current === 'ResourceManagement' ? <ResourceManagementFields maxSessions={maxSessions} onChange={(value) => update({ sessions: { ...((sectionValue?.sessions as Record<string, unknown>) ?? {}), maxConcurrentSessions: value } })} /> : null}
        {error ? <SaveFeedback mode="inline-error" message={error} /> : null}
      </CardContent></Card>}
    </StepWizard>
  </main>
}

function NavigationFields({ host, value, onChange }: { host: string; value: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const rules = Array.isArray(value.allowedMainFrameUrls) ? value.allowedMainFrameUrls : []
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="defaultTargetHost">Default target host</Label>
        <Input
          id="defaultTargetHost"
          value={host}
          onChange={(event) => onChange({ defaultTargetHost: event.target.value })}
          placeholder="example.com"
        />
        <p className="text-sm text-muted-foreground">Host only, e.g. example.com</p>
        {host && !isBareHost(host) ? (
          <p className="text-sm text-destructive">Enter a bare host without a scheme or path.</p>
        ) : null}
      </div>
      <div className="border-t border-border pt-4">
        <MainFrameAllowlistEditor
          defaultHost={host}
          rules={rules}
          onChange={(next) => onChange({ allowedMainFrameUrls: next })}
        />
      </div>
    </>
  )
}
function SessionsFields({ timeout, value, onChange }: { timeout: string; value: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  return <><div className="space-y-2"><Label htmlFor="detachedSessionTimeout">Detached session timeout</Label><Input id="detachedSessionTimeout" value={timeout} onChange={(event) => onChange({ detachedSessionTimeout: event.target.value })} placeholder="00:30:00" /><p className="text-sm text-muted-foreground">TimeSpan JSON, e.g. 00:30:00</p></div>
    <GuidedPreset presets={[{ id: 'recommended', label: 'Apply recommended session defaults', apply: () => onChange({ ...sessionsBaseline, detachedSessionTimeout: timeout || sessionsBaseline.detachedSessionTimeout }) }]} />
    {!value.viewportPolicy ? <HelperCallout tone="warning" title="Recommended defaults required">Apply recommended session defaults before this empty section can be saved.</HelperCallout> : null}
    <RevealPanel title="Advanced"><p className="text-sm text-muted-foreground">Nested policies are included in the recommended baseline. Full editing is available in the configurations editor.</p><Link className="mt-3 inline-block text-sm underline" to="/admin/configurations/Sessions">Open full editor</Link></RevealPanel>
  </>
}
function ResourceManagementFields({ maxSessions, onChange }: { maxSessions: number; onChange: (value: number) => void }) {
  return <div className="space-y-2"><Label htmlFor="maxConcurrentSessions">Max concurrent sessions</Label><Input id="maxConcurrentSessions" type="number" min="1" value={maxSessions} onChange={(event) => onChange(Number(event.target.value))} /><p className="text-sm text-muted-foreground">The number of live sessions the host can run at once.</p></div>
}
