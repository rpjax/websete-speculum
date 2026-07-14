import { useEffect, useState } from 'react'
import {
  diagnosticsApi,
  type BrowserProbeResponse,
  type MotorSessionListItem,
} from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { JsonTechnicalDetails } from '@/components/admin/JsonTechnicalDetails'
import { EmptyState } from '@/components/admin/EmptyState'

const PROBE_OPS = ['process', 'tabs', 'export', 'cookies', 'storage', 'dom', 'evaluate', 'resources'] as const

export default function DiagnosticsProbesPage() {
  const [sessions, setSessions] = useState<MotorSessionListItem[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [ops, setOps] = useState<Set<string>>(new Set(['process', 'tabs', 'resources']))
  const [evaluateExpr, setEvaluateExpr] = useState('document.title')
  const [domSelector, setDomSelector] = useState('body')
  const [result, setResult] = useState<BrowserProbeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [host, setHost] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    void diagnosticsApi.listSessions().then((r) => {
      setSessions(r.sessions)
      if (r.sessions[0]) setConnectionId(r.sessions[0].connectionId)
    }).catch(() => {})
    void diagnosticsApi.getHost().then(setHost).catch(() => setHost(null))
  }, [])

  function toggleOp(op: string, checked: boolean) {
    setOps((prev) => {
      const next = new Set(prev)
      if (checked) next.add(op)
      else next.delete(op)
      return next
    })
  }

  async function run() {
    if (!connectionId) return
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const res = await diagnosticsApi.runBrowserProbe(connectionId, {
        ops: [...ops],
        evaluateExpression: ops.has('evaluate') ? evaluateExpr : undefined,
        domSelector: ops.has('dom') ? domSelector : undefined,
      })
      setResult(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Probe failed')
    } finally {
      setPending(false)
    }
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        title="No live session to probe"
        description="Start a Motor session first. Host resource sample is still available below when Diagnostics allows it."
        action={host ? <JsonTechnicalDetails data={host} title="Host sample" /> : undefined}
      />
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Browser probe</CardTitle>
          <CardDescription>
            Guided probe against a live connection. Results are structured; raw payload stays in Technical details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Connection</Label>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem key={s.connectionId} value={s.connectionId}>
                    {s.connectionId.slice(0, 12)}… · {s.phase}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROBE_OPS.map((op) => (
              <label key={op} className="flex items-center gap-2 text-sm">
                <Checkbox checked={ops.has(op)} onCheckedChange={(c) => toggleOp(op, !!c)} />
                {op}
              </label>
            ))}
          </div>
          {ops.has('evaluate') && (
            <div className="space-y-1">
              <Label htmlFor="eval">Evaluate expression</Label>
              <Input id="eval" value={evaluateExpr} onChange={(e) => setEvaluateExpr(e.target.value)} />
            </div>
          )}
          {ops.has('dom') && (
            <div className="space-y-1">
              <Label htmlFor="dom">DOM selector</Label>
              <Input id="dom" value={domSelector} onChange={(e) => setDomSelector(e.target.value)} />
            </div>
          )}
          <Button disabled={pending || ops.size === 0} onClick={() => void run()}>
            {pending ? 'Running…' : 'Run probe'}
          </Button>
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Result
              <Badge variant={result.ok ? 'success' : 'destructive'}>{result.ok ? 'ok' : result.errorCode ?? 'failed'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.correlationId && (
              <p className="text-xs text-muted-foreground">correlation {result.correlationId}</p>
            )}
            {result.data != null && typeof result.data === 'object' ? (
              <ul className="space-y-1 text-sm">
                {Object.keys(result.data as object).slice(0, 12).map((k) => (
                  <li key={k} className="flex justify-between gap-4 border-b border-border/40 py-1">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="truncate font-mono text-xs">
                      {summarize((result.data as Record<string, unknown>)[k])}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <JsonTechnicalDetails data={result} />
          </CardContent>
        </Card>
      )}

      {host && <JsonTechnicalDetails data={host} title="Host resources sample" />}
    </div>
  )
}

function summarize(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return Array.isArray(v) ? `[${v.length}]` : '{…}'
}
