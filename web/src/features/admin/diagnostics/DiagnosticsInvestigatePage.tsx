import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  diagnosticsApi,
  type BrowserProbeResponse,
  type MotorSessionListItem,
} from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ResourceGauge } from '@/components/admin/ResourceGauge'
import { ExportButton } from '@/components/admin/ExportButton'
import { Skeleton } from '@/components/ui/skeleton'
import { PROBE_OPS, PROBE_QUICK_PICKS, LEVEL_LABELS, formatBytes } from '@/lib/diagnosticsConstants'
import { describeErrorCode, humanizeConnectionId } from '@/lib/diagnosticsDescriptions'
import { useProbeHistory, useProbeTemplates, type ProbeHistoryEntry } from '@/lib/hooks/useProbeHistory'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  ChevronDown, ChevronRight, Monitor, Cpu, Zap,
  Globe, Radio, Server, CheckCircle2, XCircle,
  Braces, Cookie, HardDrive, Terminal, FileCode,
  BookOpen, HelpCircle, AlertTriangle, Info,
  History, Save, Trash2, Play, BookTemplate,
} from 'lucide-react'

const STEP_ICONS = { process: Cpu, tabs: Globe, resources: HardDrive, export: Zap, cookies: Cookie, storage: Server, dom: FileCode, evaluate: Terminal }

export default function DiagnosticsInvestigatePage() {
  const [searchParams] = useSearchParams()
  const [sessions, setSessions] = useState<MotorSessionListItem[]>([])
  const [connectionId, setConnectionId] = useState(searchParams.get('connectionId') ?? '')
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set(['process', 'tabs', 'resources']))
  const [evaluateExpr, setEvaluateExpr] = useState('document.title')
  const [domSelector, setDomSelector] = useState('body')
  const [result, setResult] = useState<BrowserProbeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [host, setHost] = useState<Record<string, unknown> | null>(null)
  const [loadingHost, setLoadingHost] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const { history, addEntry, clearHistory } = useProbeHistory()
  const { templates, saveTemplate, deleteTemplate } = useProbeTemplates()

  useEffect(() => {
    void diagnosticsApi.listSessions()
      .then((r) => {
        setSessions(r.sessions)
        if (!connectionId && r.sessions[0]) setConnectionId(r.sessions[0].connectionId)
      })
      .catch(() => {})
    void diagnosticsApi.getHost()
      .then(setHost)
      .catch(() => setHost(null))
      .finally(() => setLoadingHost(false))
  }, [])

  function applyQuickPick(ops: readonly string[]) { setSelectedOps(new Set(ops)) }
  function toggleOp(op: string, checked: boolean) {
    setSelectedOps((prev) => { const next = new Set(prev); if (checked) next.add(op); else next.delete(op); return next })
  }

  function applyTemplate(ops: string[], evalExpr?: string, domSel?: string) {
    setSelectedOps(new Set(ops))
    if (evalExpr) setEvaluateExpr(evalExpr)
    if (domSel) setDomSelector(domSel)
  }

  async function runProbe() {
    if (!connectionId) return
    setPending(true); setError(null); setResult(null)
    const start = Date.now()
    try {
      const res = await diagnosticsApi.runBrowserProbe(connectionId, {
        ops: [...selectedOps],
        evaluateExpression: selectedOps.has('evaluate') ? evaluateExpr : undefined,
        domSelector: selectedOps.has('dom') ? domSelector : undefined,
      })
      setResult(res)
      addEntry(connectionId, [...selectedOps], res, Date.now() - start)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Probe failed')
    } finally { setPending(false) }
  }

  async function autoHealthCheck() {
    if (sessions.length === 0) { setError('No live sessions'); return }
    setPending(true); setError(null); setResult(null)
    const start = Date.now()
    const target = connectionId || sessions[0].connectionId
    setConnectionId(target)
    setSelectedOps(new Set(['process', 'tabs', 'resources']))
    try {
      const res = await diagnosticsApi.runBrowserProbe(target, { ops: ['process', 'tabs', 'resources'] })
      setResult(res)
      addEntry(target, ['process', 'tabs', 'resources'], res, Date.now() - start)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Auto check failed')
    } finally { setPending(false) }
  }

  function handleSaveTemplate() {
    if (!templateName.trim()) return
    saveTemplate(templateName.trim(), [...selectedOps], selectedOps.has('evaluate') ? evaluateExpr : undefined, selectedOps.has('dom') ? domSelector : undefined)
    setTemplateName('')
    setSaveTemplateOpen(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm leading-relaxed text-primary/90">
          <p>
            <strong>Browser probes</strong> inspect a live browser's internal state. Select a session, choose operations, and run.
            Some operations need <strong>BrowserQuery</strong> level (purple badge) — use <strong>Elevate</strong> on the Health tab first.
          </p>
        </div>
      </div>

      {/* Quick bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => void autoHealthCheck()} disabled={pending || sessions.length === 0}>
          <Zap className="h-3 w-3" /> Auto health check
        </Button>
        <Button variant={showHistory ? 'default' : 'outline'} size="sm" className="h-8 gap-1 text-xs" onClick={() => setShowHistory(!showHistory)}>
          <History className="h-3 w-3" /> History ({history.length})
        </Button>
        <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={selectedOps.size === 0}>
              <Save className="h-3 w-3" /> Save as template
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save probe template</DialogTitle>
              <DialogDescription>Save the current operation selection for quick reuse.</DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Label className="text-sm">Template name</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g., Full cookie check" className="mt-1" />
              <p className="mt-2 text-xs text-muted-foreground">Operations: {[...selectedOps].join(', ')}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveTemplateOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveTemplate} disabled={!templateName.trim()}>Save template</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {result && <ExportButton data={result} filename="probe-result" />}
      </div>

      {/* Probe history panel */}
      {showHistory && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
            <h3 className="flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4 text-muted-foreground" /> Probe history</h3>
            {history.length > 0 && (
              <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px] text-muted-foreground" onClick={clearHistory}>
                <Trash2 className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>
          <div className="max-h-60 overflow-y-auto p-3">
            {history.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No probes run yet. Results will appear here.</p>
            ) : (
              <div className="space-y-1.5">
                {history.map((entry) => (
                  <ProbeHistoryRow key={entry.id} entry={entry} onRerun={() => { setConnectionId(entry.connectionId); setSelectedOps(new Set(entry.ops)); void runProbe() }} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Saved templates */}
      {templates.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-3">
            <BookTemplate className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-bold">Saved templates</h3>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-1 rounded-lg border border-border px-3 py-2">
                <button onClick={() => applyTemplate(t.ops, t.evaluateExpression, t.domSelector)} className="text-xs font-medium text-primary hover:underline">{t.name}</button>
                <span className="text-[10px] text-muted-foreground">({t.ops.length} ops)</span>
                <button onClick={() => deleteTemplate(t.id)} className="ml-1 text-muted-foreground/40 hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Select connection */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</div>
          <h3 className="text-sm font-bold">Select a session</h3>
        </div>
        <div className="p-5">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <Monitor className="h-8 w-8 text-muted-foreground/30" />
              <p className="mt-2 text-sm text-muted-foreground">No live sessions</p>
              <p className="mt-1 text-xs text-muted-foreground/60">A user must be browsing for probes to work.</p>
            </div>
          ) : (
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Select a session…" /></SelectTrigger>
              <SelectContent>
                {sessions.map((s) => {
                  let hostname = ''
                  try { if (s.currentUrl) hostname = new URL(s.currentUrl).hostname } catch {}
                  return (
                    <SelectItem key={s.connectionId} value={s.connectionId}>
                      <div className="flex items-center gap-2">
                        <Radio className="h-3 w-3 text-success" />
                        <span className="font-medium text-xs">{humanizeConnectionId(s.connectionId)}</span>
                        <span className="text-xs text-muted-foreground">{s.phase}</span>
                        {hostname && <span className="max-w-[200px] truncate text-xs text-muted-foreground">· {hostname}</span>}
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Step 2: Choose operations */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</div>
          <h3 className="text-sm font-bold">Choose what to investigate</h3>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick picks</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PROBE_QUICK_PICKS.map((qp) => {
                const isSelected = qp.ops.every((op) => selectedOps.has(op)) && selectedOps.size === qp.ops.length
                return (
                  <button key={qp.id} onClick={() => applyQuickPick(qp.ops)} className={cn(
                    'rounded-lg border p-3 text-left transition-all',
                    isSelected ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border hover:border-primary/30 hover:bg-muted/20',
                  )}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{qp.label}</span>
                      <LevelBadge level={qp.level} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{qp.description}</p>
                    <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/60">{qp.ops.join(' · ')}</p>
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Individual operations</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROBE_OPS.map((op) => {
                const OpIcon = STEP_ICONS[op.id as keyof typeof STEP_ICONS] ?? Cpu
                return (
                  <label key={op.id} className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-all',
                    selectedOps.has(op.id) ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/20',
                  )}>
                    <Checkbox checked={selectedOps.has(op.id)} onCheckedChange={(c) => toggleOp(op.id, !!c)} />
                    <OpIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{op.label}</p>
                      <p className="text-[11px] text-muted-foreground">{op.description}</p>
                    </div>
                    <LevelBadge level={op.level} />
                  </label>
                )
              })}
            </div>
          </div>
          {selectedOps.has('evaluate') && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-2">
              <Label className="text-xs font-semibold">JavaScript expression</Label>
              <Input value={evaluateExpr} onChange={(e) => setEvaluateExpr(e.target.value)} placeholder="document.title" className="font-mono text-sm" />
              <p className="text-[11px] text-muted-foreground">Evaluated in the browser's page context</p>
            </div>
          )}
          {selectedOps.has('dom') && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-2">
              <Label className="text-xs font-semibold">CSS selector</Label>
              <Input value={domSelector} onChange={(e) => setDomSelector(e.target.value)} placeholder="body" className="font-mono text-sm" />
              <p className="text-[11px] text-muted-foreground">Captures a DOM snapshot from this element</p>
            </div>
          )}
        </div>
      </div>

      {/* Step 3: Run */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</div>
          <h3 className="text-sm font-bold">Run the probe</h3>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <Button disabled={pending || selectedOps.size === 0 || !connectionId} onClick={() => void runProbe()} className="gap-1.5">
              <Zap className="h-4 w-4" /> {pending ? 'Running…' : `Run probe (${selectedOps.size} op${selectedOps.size !== 1 ? 's' : ''})`}
            </Button>
            {selectedOps.size === 0 && <p className="text-xs text-muted-foreground">Select at least one operation</p>}
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{error}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">If timed out, increase diagTimeoutMs in Governance → Advanced.</p>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {result && <ProbeResults result={result} />}

      {/* Host resources */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <Server className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Host resources</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Always available</span>
        </div>
        <div className="p-5">
          {loadingHost ? <Skeleton className="h-20" /> : host ? <HostResourcesDisplay host={host} /> : <p className="text-sm text-muted-foreground">Unavailable.</p>}
        </div>
      </div>
    </div>
  )
}

function ProbeHistoryRow({ entry, onRerun }: { entry: ProbeHistoryEntry; onRerun: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/20">
      {entry.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{humanizeConnectionId(entry.connectionId)}</span>
          <span className="text-muted-foreground">{entry.ops.join(', ')}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
          {entry.durationMs && <span>{entry.durationMs}ms</span>}
          {Object.keys(entry.summary).length > 0 && (
            <span className="truncate">{Object.entries(entry.summary).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
          )}
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={onRerun} className="text-muted-foreground hover:text-primary"><Play className="h-3 w-3" /></button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">Re-run this probe</TooltipContent>
      </Tooltip>
    </div>
  )
}

function LevelBadge({ level }: { level: string }) {
  const isBQ = level === 'BrowserQuery'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
          isBQ ? 'bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/20' : 'bg-muted text-muted-foreground',
        )}>
          {LEVEL_LABELS[level] ?? level}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {isBQ ? 'Requires BrowserQuery — enable via Elevate on Health tab.' : 'Works at basic Events/Metrics level.'}
      </TooltipContent>
    </Tooltip>
  )
}

function ProbeResults({ result }: { result: BrowserProbeResponse }) {
  const [showRaw, setShowRaw] = useState(false)
  const data = result.data as Record<string, unknown> | null

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
        {result.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
        <h3 className="text-sm font-bold">Probe results</h3>
        <Badge variant={result.ok ? 'success' : 'destructive'}>{result.ok ? 'Success' : result.errorCode ?? 'Failed'}</Badge>
        {result.correlationId && <span className="font-mono text-xs text-muted-foreground">{result.correlationId}</span>}
        <div className="ml-auto"><ExportButton data={result} filename="probe-result" /></div>
      </div>
      <div className="p-5">
        {!result.ok && result.errorCode && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-sm font-bold text-destructive"><AlertTriangle className="h-3.5 w-3.5" />{describeErrorCode(result.errorCode).summary}</div>
            <p className="mt-1.5 text-xs text-destructive/80 leading-relaxed">{describeErrorCode(result.errorCode).detail}</p>
            {describeErrorCode(result.errorCode).action && <p className="mt-2 flex items-center gap-1 text-xs font-medium text-primary"><HelpCircle className="h-3 w-3" /> {describeErrorCode(result.errorCode).action}</p>}
          </div>
        )}
        {data && (
          <div className="grid gap-4 md:grid-cols-2">
            {data.process != null && <ProbeCard title="Process" description="Browser process info" icon={<Cpu className="h-3.5 w-3.5" />} data={data.process as Record<string, unknown>} />}
            {data.resources != null && <ProbeResourceCard data={data.resources as Record<string, unknown>} />}
            {data.tabs != null && <ProbeCard title={`Open tabs (${Array.isArray(data.tabs) ? (data.tabs as unknown[]).length : 0})`} description="Tabs in remote browser" icon={<Globe className="h-3.5 w-3.5" />} data={data.tabs} />}
            {data.cookies != null && <ProbeCookiesCard cookies={data.cookies as Record<string, string>[]} />}
            {data.localStorage != null && <ProbeCard title="Local storage" description="Website key-value data" icon={<Server className="h-3.5 w-3.5" />} data={data.localStorage} />}
            {data.evaluate != null && (
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="mb-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Terminal className="h-3.5 w-3.5" /> Evaluate result</p>
                <p className="mb-2 text-[11px] text-muted-foreground">JS expression output</p>
                <code className="block rounded-md bg-muted/50 p-2 font-mono text-sm">{JSON.stringify(data.evaluate)}</code>
              </div>
            )}
            {data.dom != null && <ProbeCard title="DOM snapshot" description="HTML from CSS selector" icon={<FileCode className="h-3.5 w-3.5" />} data={data.dom} />}
            {data.export != null && <ProbeCard title="Export" description="State export data" icon={<Zap className="h-3.5 w-3.5" />} data={data.export} />}
          </div>
        )}
        <button onClick={() => setShowRaw(!showRaw)} className="mt-4 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <Braces className="h-3 w-3" /> {showRaw ? 'Hide' : 'Show'} raw JSON {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        {showRaw && <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}
      </div>
    </div>
  )
}

function ProbeCard({ title, description, icon, data }: { title: string; description: string; icon: React.ReactNode; data: unknown }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p className="mb-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{icon} {title}</p>
      <p className="mb-3 text-[11px] text-muted-foreground">{description}</p>
      {typeof data === 'object' && data !== null && !Array.isArray(data) ? (
        <dl className="space-y-1.5">{Object.entries(data as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-mono text-xs">{formatProbeVal(v)}</dd></div>
        ))}</dl>
      ) : <pre className="text-xs">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}

function ProbeResourceCard({ data }: { data: Record<string, unknown> }) {
  const heapUsed = data.jsHeapUsed as number | undefined
  const heapTotal = data.jsHeapTotal as number | undefined
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p className="mb-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><HardDrive className="h-3.5 w-3.5" /> Resources</p>
      <p className="mb-3 text-[11px] text-muted-foreground">JS engine memory usage</p>
      {heapUsed != null && heapTotal != null ? <ResourceGauge label="JS Heap" used={heapUsed} total={heapTotal} formatValue={formatBytes} /> : <pre className="text-xs">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}

function ProbeCookiesCard({ cookies }: { cookies: Record<string, string>[] }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 md:col-span-2">
      <p className="mb-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Cookie className="h-3.5 w-3.5" /> Cookies ({cookies.length})</p>
      <p className="mb-3 text-[11px] text-muted-foreground">HTTP cookies stored in the remote browser</p>
      <div className="max-h-48 overflow-auto rounded-md border border-border/50">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card"><tr className="border-b border-border/50 text-left text-muted-foreground"><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Domain</th><th className="px-3 py-1.5">Value</th></tr></thead>
          <tbody>{cookies.map((c, i) => (
            <tr key={i} className="border-b border-border/30 hover:bg-muted/20"><td className="px-3 py-1.5 font-mono">{c.name}</td><td className="px-3 py-1.5">{c.domain}</td><td className="max-w-[200px] truncate px-3 py-1.5 font-mono">{c.value}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function HostResourcesDisplay({ host }: { host: Record<string, unknown> }) {
  const memUsed = host.memoryUsed as number | undefined
  const memTotal = host.memoryTotal as number | undefined
  const cpuUsage = host.cpuUsage as number | undefined
  return (
    <div className="space-y-4">
      {host.hostname != null && (
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{String(host.hostname)}</span>
          {host.uptime != null && <span className="text-xs text-muted-foreground">· uptime {Math.round((host.uptime as number) / 3600)}h</span>}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {memUsed != null && memTotal != null && <ResourceGauge label="Memory" used={memUsed} total={memTotal} formatValue={formatBytes} />}
        {cpuUsage != null && <ResourceGauge label="CPU" used={Math.round(cpuUsage * 100)} total={100} formatValue={(n) => `${n}%`} />}
      </div>
      {host.gcCollections != null && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Info className="h-3 w-3" />GC:</span>
          {Object.entries(host.gcCollections as Record<string, number>).map(([gen, count]) => (
            <span key={gen}>Gen {gen}: <span className="font-medium text-foreground">{count}</span></span>
          ))}
        </div>
      )}
    </div>
  )
}

function formatProbeVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return Array.isArray(v) ? `[${v.length}]` : '{…}'
}
