import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ConfigSections } from '@/lib/api'
import {
  diagnosticsApi,
  type BrowserProbeResponse,
  type DiagnosticsEventRecord,
  type DiagnosticsOptions,
  type DiagnosticsRuntimeSnapshot,
  type MotorSessionDiagnosticsSnapshot,
  type MotorSessionListItem,
} from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'

const PROBE_OPS = [
  'process',
  'tabs',
  'export',
  'cookies',
  'storage',
  'dom',
  'evaluate',
  'resources',
] as const

const LEVELS = ['Off', 'Metrics', 'Events', 'StateSnapshots', 'BrowserQuery'] as const
const OVERFLOW_MODES = ['DropOldest'] as const

interface PersistedSessionItem {
  sessionId: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  clientToken: string
  cookieCount: number
  localStorageCount: number
  idbRecordCount: number
  historyCount: number
}

const DEFAULT_CONFIG: DiagnosticsOptions = {
  enabled: true,
  defaultLevel: 'Events',
  domains: {
    motorLive: 'Events',
    sidecarBrowser: 'Metrics',
    hostResources: 'Metrics',
    browserQuery: 'Off',
    persistedSessions: 'StateSnapshots',
  },
  storage: {
    maxBytes: 64 * 1024 * 1024,
    maxEventsPerSession: 5000,
    ttlHours: 24,
    overflow: 'DropOldest',
  },
  sampling: {
    statusMirrorRatio: 1,
    expensiveEventRatio: 0.25,
  },
  elevate: {
    browserQueryMaxMinutes: 30,
  },
  probe: {
    diagTimeoutMs: 10_000,
    maxConcurrentProbesPerSession: 2,
    maxProbeResponseBytes: 512 * 1024,
    hostSampleIntervalMs: 1000,
  },
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}

export default function DiagnosticsPage() {
  const [runtime, setRuntime] = useState<DiagnosticsRuntimeSnapshot | null>(null)
  const [sessions, setSessions] = useState<MotorSessionListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<MotorSessionDiagnosticsSnapshot | null>(null)
  const [events, setEvents] = useState<DiagnosticsEventRecord[]>([])
  const [eventsSince, setEventsSince] = useState('')
  const [elevateFloor, setElevateFloor] = useState('BrowserQuery')
  const [elevateMinutes, setElevateMinutes] = useState('15')
  const [probeOps, setProbeOps] = useState<Set<string>>(new Set(['process', 'tabs', 'resources']))
  const [evaluateExpr, setEvaluateExpr] = useState('document.title')
  const [domSelector, setDomSelector] = useState('body')
  const [probeResult, setProbeResult] = useState<BrowserProbeResponse | null>(null)
  const [host, setHost] = useState<Record<string, unknown> | null>(null)
  const [hostError, setHostError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<string[]>([])
  const [persisted, setPersisted] = useState<PersistedSessionItem[]>([])
  const [selectedPersistedId, setSelectedPersistedId] = useState<string | null>(null)
  const [persistedDetail, setPersistedDetail] = useState<unknown>(null)
  const [config, setConfig] = useState<DiagnosticsOptions>(DEFAULT_CONFIG)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshRuntime = useCallback(async () => {
    const [rt, sess, cat, pers] = await Promise.all([
      diagnosticsApi.getRuntime(),
      diagnosticsApi.listSessions(),
      diagnosticsApi.getEventCatalog(),
      diagnosticsApi.listPersisted() as Promise<PersistedSessionItem[]>,
    ])
    setRuntime(rt)
    setSessions(sess.sessions)
    setCatalog(cat.events)
    setPersisted(pers)
    setHostError(null)
    try {
      setHost(await diagnosticsApi.getHost())
    } catch (e: unknown) {
      setHost(null)
      setHostError(e instanceof Error ? e.message : 'Host sample unavailable')
    }
  }, [])

  useEffect(() => {
    void refreshRuntime().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Failed to load diagnostics'),
    )
    api.getSection<DiagnosticsOptions>(ConfigSections.Diagnostics)
      .then(setConfig)
      .catch(() => {})
  }, [refreshRuntime])

  useEffect(() => {
    if (!selectedId) {
      setSessionDetail(null)
      setEvents([])
      return
    }
    void (async () => {
      try {
        const [detail, evts] = await Promise.all([
          diagnosticsApi.getSession(selectedId),
          diagnosticsApi.getSessionEvents(selectedId, eventsSince || undefined),
        ])
        setSessionDetail(detail)
        setEvents(evts)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load session')
      }
    })()
  }, [selectedId, eventsSince])

  useEffect(() => {
    if (!selectedPersistedId) {
      setPersistedDetail(null)
      return
    }
    void diagnosticsApi.getPersisted(selectedPersistedId)
      .then(setPersistedDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load persisted session'))
  }, [selectedPersistedId])

  async function handleElevate() {
    setMessage(null)
    setError(null)
    try {
      await diagnosticsApi.elevate({
        browserQueryFloor: elevateFloor as DiagnosticsOptions['defaultLevel'],
        minutes: Number(elevateMinutes),
      })
      setMessage('Elevated BrowserQuery floor')
      await refreshRuntime()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Elevate failed')
    }
  }

  async function handleClearElevate() {
    setMessage(null)
    setError(null)
    try {
      await diagnosticsApi.clearElevate()
      setMessage('Elevate cleared')
      await refreshRuntime()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clear elevate failed')
    }
  }

  async function handleProbe() {
    if (!selectedId) return
    setMessage(null)
    setError(null)
    setProbeResult(null)
    try {
      const result = await diagnosticsApi.runBrowserProbe(selectedId, {
        ops: [...probeOps],
        evaluateExpression: probeOps.has('evaluate') ? evaluateExpr : undefined,
        domSelector: probeOps.has('dom') ? domSelector : undefined,
      })
      setProbeResult(result)
      setMessage('Probe completed')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Probe failed')
    }
  }

  async function saveConfig() {
    setMessage(null)
    setError(null)
    try {
      await api.putSection(ConfigSections.Diagnostics, config)
      setMessage('Diagnostics config saved')
      await refreshRuntime()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function removeConfig() {
    setMessage(null)
    setError(null)
    try {
      await api.deleteSection(ConfigSections.Diagnostics)
      try {
        setConfig(await api.getSection<DiagnosticsOptions>(ConfigSections.Diagnostics))
      } catch {
        setConfig(DEFAULT_CONFIG)
      }
      setMessage('Diagnostics config deleted and reseeded')
      await refreshRuntime()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  function toggleProbeOp(op: string) {
    setProbeOps((prev) => {
      const next = new Set(prev)
      if (next.has(op)) next.delete(op)
      else next.add(op)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Diagnostics</h1>
        <Button variant="outline" size="sm" onClick={() => void refreshRuntime()}>
          Refresh
        </Button>
      </div>

      {message && <p className="text-green-400">{message}</p>}
      {error && <p className="text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Runtime</CardTitle>
          <CardDescription>Live diagnostics pipeline snapshot</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {runtime ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge className={runtime.enabled ? 'border-green-700 text-green-400' : 'border-muted text-muted-foreground'}>
                  {runtime.enabled ? 'enabled' : 'disabled'}
                </Badge>
                {runtime.degraded && (
                  <Badge className="border-amber-700 text-amber-400">degraded</Badge>
                )}
                <Badge className="border-muted text-muted-foreground">
                  schema v{runtime.diagnosticsSchemaVersion}
                </Badge>
                <Badge className="border-muted text-muted-foreground">
                  {runtime.redactionMode}
                </Badge>
              </div>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Bytes used</dt><dd>{formatBytes(runtime.bytesUsed)}</dd></div>
                <div><dt className="text-muted-foreground">Events stored</dt><dd>{runtime.eventsStored}</dd></div>
                <div><dt className="text-muted-foreground">Events dropped</dt><dd>{runtime.eventsDropped}</dd></div>
                <div><dt className="text-muted-foreground">Overflow count</dt><dd>{runtime.overflowCount}</dd></div>
                <div><dt className="text-muted-foreground">Probes in flight</dt><dd>{runtime.probeInFlight}</dd></div>
                <div><dt className="text-muted-foreground">Last cleanup</dt><dd>{runtime.lastCleanupUtc ?? '—'}</dd></div>
              </dl>
              <div>
                <p className="mb-1 text-muted-foreground">Effective levels</p>
                <ul className="list-disc pl-5">
                  {Object.entries(runtime.effectiveLevels).map(([k, v]) => (
                    <li key={k}><span className="font-mono text-xs">{k}</span>: {v}</li>
                  ))}
                </ul>
              </div>
              {runtime.elevate && (
                <p className="text-amber-400">
                  Elevated: {runtime.elevate.browserQueryFloor ?? 'BrowserQuery'}
                  {runtime.elevate.expiresUtc ? ` until ${runtime.elevate.expiresUtc}` : ''}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Host</CardTitle>
          <CardDescription>API process resource sample</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {hostError && <p className="text-muted-foreground">{hostError}</p>}
          {host ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              {Object.entries(host).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono text-xs">{typeof v === 'number' && k.toLowerCase().includes('mem') ? formatBytes(v) : String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : !hostError && <p className="text-muted-foreground">Loading…</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event catalog</CardTitle>
          <CardDescription>{catalog.length} stable event name(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2">Domain</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((name) => (
                  <tr key={name} className="border-b border-border/50">
                    <td className="py-1 pr-4 font-mono text-xs">{name}</td>
                    <td className="py-1">{name.split('.')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Persisted sessions</CardTitle>
          <CardDescription>{persisted.length} stored browser session(s)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {persisted.length === 0 && (
            <p className="text-sm text-muted-foreground">No persisted sessions.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4">Session</th>
                  <th className="py-2 pr-4">Updated</th>
                  <th className="py-2 pr-4">Cookies</th>
                  <th className="py-2">Storage</th>
                </tr>
              </thead>
              <tbody>
                {persisted.map((s) => (
                  <tr key={s.sessionId} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        className="font-mono text-xs text-primary hover:underline"
                        onClick={() => setSelectedPersistedId(s.sessionId)}
                      >
                        {s.sessionId.slice(0, 12)}…
                      </button>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{s.updatedAt}</td>
                    <td className="py-2 pr-4">{s.cookieCount}</td>
                    <td className="py-2">{s.localStorageCount} LS / {s.idbRecordCount} IDB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedPersistedId && (
            <div className="space-y-2">
              <p className="font-mono text-xs text-muted-foreground">{selectedPersistedId}</p>
              <Textarea
                readOnly
                className="min-h-[100px] font-mono text-xs"
                value={persistedDetail ? JSON.stringify(persistedDetail, null, 2) : 'Loading…'}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Elevate BrowserQuery</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="elev-floor">Floor level</Label>
              <select
                id="elev-floor"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={elevateFloor}
                onChange={(e) => setElevateFloor(e.target.value)}
              >
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="elev-min">Minutes</Label>
              <Input
                id="elev-min"
                type="number"
                min={1}
                value={elevateMinutes}
                onChange={(e) => setElevateMinutes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void handleElevate()}>Elevate</Button>
            <Button variant="outline" onClick={() => void handleClearElevate()}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live sessions</CardTitle>
          <CardDescription>{sessions.length} session(s)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">No active motor sessions.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4">Connection</th>
                  <th className="py-2 pr-4">Phase</th>
                  <th className="py-2 pr-4">URL</th>
                  <th className="py-2">Sidecar</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.connectionId} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        className="font-mono text-xs text-primary hover:underline"
                        onClick={() => setSelectedId(s.connectionId)}
                      >
                        {s.connectionId.slice(0, 12)}…
                      </button>
                    </td>
                    <td className="py-2 pr-4">{s.phase}{s.starting ? ' (starting)' : ''}</td>
                    <td className="max-w-[200px] truncate py-2 pr-4" title={s.currentUrl}>{s.currentUrl || '—'}</td>
                    <td className="py-2 font-mono text-xs">{s.sidecarSessionId.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedId && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Session detail</CardTitle>
              <CardDescription className="font-mono text-xs">{selectedId}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {sessionDetail ? (
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Phase</dt><dd>{sessionDetail.phase}</dd></div>
                  <div><dt className="text-muted-foreground">FPS</dt><dd>{sessionDetail.fps.toFixed(1)}</dd></div>
                  <div><dt className="text-muted-foreground">Uptime</dt><dd>{sessionDetail.uptimeMs} ms</dd></div>
                  <div><dt className="text-muted-foreground">Sidecar connected</dt><dd>{sessionDetail.sidecarConnected ? 'yes' : 'no'}</dd></div>
                  <div><dt className="text-muted-foreground">Exporting</dt><dd>{sessionDetail.exportingState ? 'yes' : 'no'}</dd></div>
                  <div><dt className="text-muted-foreground">URL</dt><dd className="break-all">{sessionDetail.currentUrl || '—'}</dd></div>
                  {sessionDetail.correlationId && (
                    <div><dt className="text-muted-foreground">Correlation</dt><dd className="font-mono text-xs">{sessionDetail.correlationId}</dd></div>
                  )}
                </dl>
              ) : (
                <p className="text-muted-foreground">Loading…</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Events</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-2">
                  <Label htmlFor="since">Since (ISO, optional)</Label>
                  <Input
                    id="since"
                    placeholder="2026-01-01T00:00:00Z"
                    value={eventsSince}
                    onChange={(e) => setEventsSince(e.target.value)}
                  />
                </div>
                <Button variant="outline" onClick={() => setEventsSince('')}>Clear filter</Button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border p-2 font-mono text-xs">
                {events.length === 0 && <p className="text-muted-foreground">No events.</p>}
                {events.map((e) => (
                  <div key={e.id} className="border-b border-border/30 py-1">
                    <span className="text-muted-foreground">{e.utc}</span>{' '}
                    <span className="text-primary">{e.name}</span>{' '}
                    <span className="text-muted-foreground">({e.severity})</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Browser probe</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                {PROBE_OPS.map((op) => (
                  <label key={op} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={probeOps.has(op)}
                      onChange={() => toggleProbeOp(op)}
                    />
                    {op}
                  </label>
                ))}
              </div>
              {probeOps.has('evaluate') && (
                <div className="space-y-2">
                  <Label htmlFor="eval-expr">Evaluate expression</Label>
                  <Input id="eval-expr" value={evaluateExpr} onChange={(e) => setEvaluateExpr(e.target.value)} />
                </div>
              )}
              {probeOps.has('dom') && (
                <div className="space-y-2">
                  <Label htmlFor="dom-sel">DOM selector</Label>
                  <Input id="dom-sel" value={domSelector} onChange={(e) => setDomSelector(e.target.value)} />
                </div>
              )}
              <Button onClick={() => void handleProbe()}>Run probe</Button>
              {probeResult && (
                <Textarea
                  readOnly
                  className="min-h-[120px] font-mono text-xs"
                  value={JSON.stringify(probeResult, null, 2)}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            <Link to="/admin/openapi" className="text-primary underline">OpenAPI</Link>
            {' '}— section <code className="text-xs">Diagnostics</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="diag-enabled"
              checked={config.enabled}
              onCheckedChange={(v) => setConfig((c) => ({ ...c, enabled: v }))}
            />
            <Label htmlFor="diag-enabled">Enabled</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-level">Default level</Label>
            <select
              id="default-level"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={config.defaultLevel}
              onChange={(e) => setConfig((c) => ({
                ...c,
                defaultLevel: e.target.value as DiagnosticsOptions['defaultLevel'],
              }))}
            >
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(config.domains) as Array<keyof DiagnosticsOptions['domains']>).map((key) => (
              <div key={key} className="space-y-1">
                <Label>{key}</Label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={config.domains[key]}
                  onChange={(e) => setConfig((c) => ({
                    ...c,
                    domains: {
                      ...c.domains,
                      [key]: e.target.value as DiagnosticsOptions['defaultLevel'],
                    },
                  }))}
                >
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            ))}
          </div>
          <p className="text-sm font-medium">Storage</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max-bytes">Max bytes</Label>
              <Input
                id="max-bytes"
                type="number"
                value={config.storage.maxBytes}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  storage: { ...c.storage, maxBytes: Number(e.target.value) },
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-events">Max events per session</Label>
              <Input
                id="max-events"
                type="number"
                value={config.storage.maxEventsPerSession}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  storage: { ...c.storage, maxEventsPerSession: Number(e.target.value) },
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ttl">TTL (hours)</Label>
              <Input
                id="ttl"
                type="number"
                value={config.storage.ttlHours}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  storage: { ...c.storage, ttlHours: Number(e.target.value) },
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="overflow">Overflow</Label>
              <select
                id="overflow"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={config.storage.overflow}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  storage: { ...c.storage, overflow: e.target.value },
                }))}
              >
                {OVERFLOW_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <p className="text-sm font-medium">Sampling</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="status-mirror">Status mirror ratio</Label>
              <Input
                id="status-mirror"
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={config.sampling.statusMirrorRatio}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  sampling: { ...c.sampling, statusMirrorRatio: Number(e.target.value) },
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expensive-ratio">Expensive event ratio</Label>
              <Input
                id="expensive-ratio"
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={config.sampling.expensiveEventRatio}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  sampling: { ...c.sampling, expensiveEventRatio: Number(e.target.value) },
                }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="elevate-max">Elevate browserQuery max (minutes)</Label>
            <Input
              id="elevate-max"
              type="number"
              value={config.elevate.browserQueryMaxMinutes}
              onChange={(e) => setConfig((c) => ({
                ...c,
                elevate: { ...c.elevate, browserQueryMaxMinutes: Number(e.target.value) },
              }))}
            />
          </div>
          <p className="text-sm font-medium">Probe</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="probe-timeout">Timeout (ms)</Label>
              <Input
                id="probe-timeout"
                type="number"
                value={config.probe.diagTimeoutMs}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  probe: { ...c.probe, diagTimeoutMs: Number(e.target.value) },
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="probe-concurrent">Max concurrent per session</Label>
              <Input
                id="probe-concurrent"
                type="number"
                value={config.probe.maxConcurrentProbesPerSession}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  probe: { ...c.probe, maxConcurrentProbesPerSession: Number(e.target.value) },
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="probe-bytes">Max response bytes</Label>
              <Input
                id="probe-bytes"
                type="number"
                value={config.probe.maxProbeResponseBytes}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  probe: { ...c.probe, maxProbeResponseBytes: Number(e.target.value) },
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="host-interval">Host sample interval (ms)</Label>
              <Input
                id="host-interval"
                type="number"
                value={config.probe.hostSampleIntervalMs}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  probe: { ...c.probe, hostSampleIntervalMs: Number(e.target.value) },
                }))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void saveConfig()}>Save</Button>
            <Button variant="outline" onClick={() => void removeConfig()}>Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
