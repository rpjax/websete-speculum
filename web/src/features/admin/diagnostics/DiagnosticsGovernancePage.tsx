import { useCallback, useEffect, useState, useRef } from 'react'
import { diagnosticsApi, type DiagnosticsOverview, type DiagnosticsOptions, type DiagnosticsLevel } from '@/lib/diagnosticsApi'
import { api, ConfigSections } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ResourceGauge } from '@/components/admin/ResourceGauge'
import { SystemStateBanner } from '@/components/admin/SystemStateBanner'
import { ExportButton } from '@/components/admin/ExportButton'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DOMAIN_LABELS, LEVEL_ORDER, LEVEL_LABELS, LEVEL_DESCRIPTIONS,
  formatBytes, formatRelativeTime, DOMAIN_COLORS,
} from '@/lib/diagnosticsConstants'
import { humanizeDomain } from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'
import {
  Info, Save, RotateCcw, Layers, Eye, EyeOff, ShieldCheck,
  ShieldAlert, Zap, ArrowRight, HardDrive, Clock, Settings,
  Gauge, FlaskConical, Activity, BookOpen, HelpCircle,
  Upload, Download, FileJson, AlertTriangle, CheckCircle2,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react'

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
  storage: { maxBytes: 64 * 1024 * 1024, maxEventsPerSession: 5000, ttlHours: 24, overflow: 'DropOldest' },
  sampling: { statusMirrorRatio: 1, expensiveEventRatio: 0.25 },
  elevate: { browserQueryMaxMinutes: 30 },
  probe: { diagTimeoutMs: 10_000, maxConcurrentProbesPerSession: 2, maxProbeResponseBytes: 512 * 1024, hostSampleIntervalMs: 1000 },
}

export default function DiagnosticsGovernancePage() {
  const [overview, setOverview] = useState<DiagnosticsOverview | null>(null)
  const [config, setConfig] = useState<DiagnosticsOptions>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [savedConfig, setSavedConfig] = useState<DiagnosticsOptions>(DEFAULT_CONFIG)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ov, section] = await Promise.all([
        diagnosticsApi.getOverview(),
        api.getSection<DiagnosticsOptions>(ConfigSections.Diagnostics),
      ])
      setOverview(ov)
      const merged = { ...DEFAULT_CONFIG, ...section }
      setConfig(merged)
      setSavedConfig(merged)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load governance data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await api.putSection(ConfigSections.Diagnostics, config)
      setMessage('Configuration saved successfully. Changes take effect immediately.')
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setConfig(DEFAULT_CONFIG)
    setResetOpen(false)
    setSaving(true)
    try {
      await api.putSection(ConfigSections.Diagnostics, DEFAULT_CONFIG)
      setMessage('Reset to defaults — all levels, storage, and probe settings restored.')
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleRecover() {
    setRecovering(true)
    try {
      await diagnosticsApi.recover()
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Recovery failed')
    } finally {
      setRecovering(false)
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string) as DiagnosticsOptions
        if (!imported.domains || !imported.storage) throw new Error('Invalid config structure')
        setConfig({ ...DEFAULT_CONFIG, ...imported })
        setMessage('Configuration imported — review changes and click Save to apply.')
      } catch {
        setImportError('Invalid configuration file. Must be a valid JSON diagnostics config.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function handleClearElevate() {
    try {
      await diagnosticsApi.clearElevate()
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clear elevate failed')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Explanation header */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm leading-relaxed text-primary/90">
          <p>
            <strong>Governance</strong> controls how much diagnostic data the motor collects and retains.
            Each domain can be set to a level — higher levels collect more data but use more resources.
            Changes here take effect immediately across all sessions.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{message}</div>
      )}

      {/* System state */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">System state</h3>
          <Tooltip>
            <TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60" /></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              The diagnostics pipeline has three states: Normal (all working), Elevated (deep inspection temporarily enabled), 
              and Degraded (circuit breaker tripped due to errors, some features limited).
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="p-5 space-y-5">
          {overview && (
            <SystemStateBanner
              degraded={overview.degraded}
              elevate={overview.elevate}
              onRecover={handleRecover}
              onClearElevate={handleClearElevate}
              recovering={recovering}
            />
          )}
          <StateLifecycleDiagram current={overview?.degraded ? 'Degraded' : overview?.elevate?.active ? 'Elevated' : 'Normal'} />
          {overview && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>Redaction: <span className="font-medium text-foreground">{overview.redactionMode}</span></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Controls whether sensitive data (URLs, cookies, user identifiers) is redacted from diagnostic events before storage.
                </TooltipContent>
              </Tooltip>
              <span className="text-border">|</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>Schema: <span className="font-medium text-foreground">v{overview.diagnosticsSchemaVersion}</span></span>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Version of the diagnostics event schema used by this motor build</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      {/* Domain levels */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Domain levels</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm text-xs">
              Each domain controls a specific area of the motor's diagnostics. The <strong>configured</strong> level is what you set here; 
              the <strong>effective</strong> level is what's actually applied (may differ during elevation or degradation).
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="p-5 space-y-5">
          {/* Level legend */}
          <div className="rounded-lg border border-border/50 bg-muted/10 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Level reference</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {LEVEL_ORDER.map((level) => (
                <div key={level} className="rounded-md bg-muted/20 px-3 py-2">
                  <LevelPill level={level} />
                  <p className="mt-1 text-[10px] text-muted-foreground leading-tight">{LEVEL_DESCRIPTIONS[level]}</p>
                </div>
              ))}
            </div>
          </div>

          {overview && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-3 pr-4 font-semibold">Domain</th>
                    <th className="pb-3 pr-4 font-semibold">Configured</th>
                    <th className="pb-3 font-semibold">Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(config.domains) as (keyof DiagnosticsOptions['domains'])[]).map((key) => {
                    const effective = overview.effectiveLevels[key] ?? 'Off'
                    const configured = config.domains[key]
                    const mismatch = effective !== configured
                    const iconColor = DOMAIN_COLORS[key] ?? 'text-muted-foreground'
                    const isOff = effective === 'Off'
                    const domainDesc = humanizeDomain(key)
                    return (
                      <tr key={key} className="border-b border-border/30">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2.5">
                            <div className={cn('shrink-0', iconColor)}>
                              {isOff ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{DOMAIN_LABELS[key] ?? key}</p>
                              <p className="text-[11px] text-muted-foreground leading-relaxed">{domainDesc}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <LevelSelect value={configured} onChange={(v) => setConfig({ ...config, domains: { ...config.domains, [key]: v } })} />
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <LevelPill level={effective} />
                            {mismatch && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-warning" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs">
                                  The effective level differs from configured because
                                  {overview.elevate?.active ? ' BrowserQuery elevation is active' : overview.degraded ? ' the system is degraded' : ' of a system override'}.
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3 rounded-lg bg-muted/20 px-4 py-3">
            <Label className="text-sm font-medium">Default level</Label>
            <LevelSelect value={config.defaultLevel} onChange={(v) => setConfig({ ...config, defaultLevel: v })} />
            <p className="text-xs text-muted-foreground">Fallback level applied to domains without an explicit override</p>
          </div>
        </div>
      </div>

      {/* Storage budget */}
      {overview && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-bold">Storage budget</h3>
            <Tooltip>
              <TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60" /></TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Diagnostic events are stored in a ring buffer in memory. When the buffer is full,
                the oldest events are dropped. Adjust these limits to balance observability with memory usage.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="p-5 space-y-4">
            <ResourceGauge label="Byte limit" used={overview.bytesUsed} total={config.storage.maxBytes} formatValue={formatBytes} />
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow icon={<Activity className="h-3.5 w-3.5" />} label="Events per session" value={config.storage.maxEventsPerSession.toLocaleString()} tooltip="Maximum events stored per individual session. Older events for that session are dropped first." />
              <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="TTL" value={`${config.storage.ttlHours} hours`} tooltip="How long events are kept before automatic cleanup removes them." />
              <InfoRow icon={<Settings className="h-3.5 w-3.5" />} label="Overflow policy" value={config.storage.overflow} tooltip="What happens when the buffer is full. DropOldest removes the oldest events to make room." />
              <InfoRow icon={<Gauge className="h-3.5 w-3.5" />} label="Overflows" value={String(overview.overflowCount)} tooltip="Number of times the buffer overflowed and events were dropped." />
              <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="Last cleanup" value={overview.lastCleanupUtc ? formatRelativeTime(overview.lastCleanupUtc) : 'Never'} className="sm:col-span-2" tooltip="When the last TTL-based cleanup ran." />
            </div>
          </div>
        </div>
      )}

      {/* Advanced settings */}
      <Accordion type="single" collapsible>
        <AccordionItem value="advanced" className="rounded-xl border border-border bg-card">
          <AccordionTrigger className="px-5 py-4 text-sm font-bold hover:no-underline">
            <div className="flex items-center gap-3">
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
              Advanced — sampling, probe limits & storage tuning
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <p className="mb-4 text-xs text-muted-foreground leading-relaxed">
              These settings control fine-grained behavior of the diagnostics pipeline.
              Default values work well for most deployments — only change these if you understand the trade-offs.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField label="Status mirror ratio" value={config.sampling.statusMirrorRatio} step={0.1}
                onChange={(v) => setConfig({ ...config, sampling: { ...config.sampling, statusMirrorRatio: v } })}
                tooltip="Fraction of StatusMirrored events sampled (0.0–1.0). Lower values reduce noise from periodic status snapshots."
                description="0.0 = no status events, 1.0 = every event" />
              <NumberField label="Expensive event ratio" value={config.sampling.expensiveEventRatio} step={0.05}
                onChange={(v) => setConfig({ ...config, sampling: { ...config.sampling, expensiveEventRatio: v } })}
                tooltip="Fraction of expensive events sampled (0.0–1.0). Affects screencast frames and other high-volume events."
                description="Lower = less storage, but less visibility" />
              <NumberField label="Max concurrent probes" value={config.probe.maxConcurrentProbesPerSession}
                onChange={(v) => setConfig({ ...config, probe: { ...config.probe, maxConcurrentProbesPerSession: v } })}
                tooltip="Maximum probes running simultaneously per session. Higher values risk overloading the browser."
                description="Per session, concurrent" />
              <NumberField label="Max probe response" value={config.probe.maxProbeResponseBytes}
                onChange={(v) => setConfig({ ...config, probe: { ...config.probe, maxProbeResponseBytes: v } })}
                tooltip="Hard cap on probe response payload size. Large DOM snapshots or cookie lists may be truncated."
                format={(v) => formatBytes(v)} />
              <NumberField label="Host sample interval" value={config.probe.hostSampleIntervalMs}
                onChange={(v) => setConfig({ ...config, probe: { ...config.probe, hostSampleIntervalMs: v } })}
                tooltip="How often host resource metrics (CPU, memory, GC) are sampled."
                format={(v) => `${v}ms`} />
              <NumberField label="Probe timeout" value={config.probe.diagTimeoutMs}
                onChange={(v) => setConfig({ ...config, probe: { ...config.probe, diagTimeoutMs: v } })}
                tooltip="Maximum time a browser probe can take before being killed. Increase if probes timeout on heavy pages."
                format={(v) => `${v}ms`} />
              <NumberField label="Max storage bytes" value={config.storage.maxBytes}
                onChange={(v) => setConfig({ ...config, storage: { ...config.storage, maxBytes: v } })}
                tooltip="Total memory allocated for the diagnostics ring buffer."
                format={formatBytes} />
              <NumberField label="Events per session" value={config.storage.maxEventsPerSession}
                onChange={(v) => setConfig({ ...config, storage: { ...config.storage, maxEventsPerSession: v } })}
                tooltip="Maximum events kept per individual session before oldest are pruned." />
              <NumberField label="TTL (hours)" value={config.storage.ttlHours}
                onChange={(v) => setConfig({ ...config, storage: { ...config.storage, ttlHours: v } })}
                tooltip="Hours before events are automatically cleaned up, regardless of storage limits." />
              <NumberField label="Elevate max minutes" value={config.elevate.browserQueryMaxMinutes}
                onChange={(v) => setConfig({ ...config, elevate: { browserQueryMaxMinutes: v } })}
                tooltip="Maximum allowed duration for a BrowserQuery elevation. After this, the elevation automatically expires." />
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-lg bg-muted/20 px-4 py-3">
              <Switch
                id="diag-enabled"
                checked={config.enabled}
                onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
              />
              <div>
                <Label htmlFor="diag-enabled" className="text-sm font-medium">Diagnostics pipeline enabled</Label>
                <p className="text-[11px] text-muted-foreground">
                  When disabled, no events are collected and probes are unavailable. Only disable for troubleshooting the pipeline itself.
                </p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Config change preview */}
      <ConfigChangePreview current={savedConfig} pending={config} />

      {/* Import/export */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <FileJson className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Import / Export configuration</h3>
          <Tooltip>
            <TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60" /></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Export the current configuration as JSON for backup or sharing. Import a previously exported configuration file to restore settings.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-3 p-5">
          <ExportButton data={config} filename="diagnostics-config" formats={['json']} />
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3 w-3" /> Import JSON
          </Button>
          {importError && <span className="text-xs text-destructive">{importError}</span>}
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4">
        <Button onClick={() => void handleSave()} disabled={saving} className="gap-1.5">
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save configuration'}
        </Button>
        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-1.5">
              <RotateCcw className="h-4 w-4" /> Reset to defaults
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset diagnostics configuration?</DialogTitle>
              <DialogDescription className="leading-relaxed">
                This will revert all diagnostics settings to factory defaults. Active sessions immediately use new settings. Cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => void handleReset()}>Reset to defaults</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

function LevelSelect({ value, onChange }: { value: DiagnosticsLevel; onChange: (v: DiagnosticsLevel) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DiagnosticsLevel)}>
      <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        {LEVEL_ORDER.map((l) => (
          <SelectItem key={l} value={l}>
            <div>
              <span className="font-medium">{LEVEL_LABELS[l]}</span>
              <span className="ml-2 text-muted-foreground">{LEVEL_DESCRIPTIONS[l]}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function LevelPill({ level }: { level: string }) {
  const label = LEVEL_LABELS[level] ?? level
  const isBQ = level === 'BrowserQuery'
  const isOff = level === 'Off'
  return (
    <span className={cn(
      'rounded-full px-2.5 py-1 text-xs font-semibold',
      isBQ ? 'bg-violet-500/15 text-violet-400'
        : isOff ? 'bg-muted text-muted-foreground'
        : 'bg-primary/15 text-primary',
    )}>
      {label}
    </span>
  )
}

function NumberField({ label, value, onChange, tooltip, step, format, description }: {
  label: string; value: number; onChange: (v: number) => void; tooltip?: string; step?: number; format?: (v: number) => string; description?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-xs font-medium">{label}</Label>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <Input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-xs"
      />
      {(format || description) && (
        <p className="text-[10px] text-muted-foreground/60">
          {format ? format(value) : ''}
          {format && description ? ' · ' : ''}
          {description ?? ''}
        </p>
      )}
    </div>
  )
}

function InfoRow({ icon, label, value, className, tooltip }: { icon: React.ReactNode; label: string; value: string; className?: string; tooltip?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-lg bg-muted/20 px-3 py-2.5', className)}>
      <div className="text-muted-foreground">{icon}</div>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild><HelpCircle className="h-2.5 w-2.5" /></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </span>
      <span className="ml-auto text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

function StateLifecycleDiagram({ current }: { current: string }) {
  const states: { name: string; icon: typeof ShieldCheck; description: string; detail: string }[] = [
    { name: 'Normal', icon: ShieldCheck, description: 'All levels active', detail: 'Full diagnostics capability — all configured levels are in effect.' },
    { name: 'Elevated', icon: Zap, description: 'BrowserQuery unlocked', detail: 'Temporary deep inspection — cookie, DOM, and JS access is enabled.' },
    { name: 'Degraded', icon: ShieldAlert, description: 'Circuit breaker tripped', detail: 'Some features limited due to errors — manual recovery needed.' },
  ]

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-4">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">State lifecycle</p>
      <p className="mb-3 text-[11px] text-muted-foreground">
        The diagnostics pipeline transitions between these states. The current state is highlighted.
      </p>
      <div className="flex items-center gap-2">
        {states.map((state, i) => {
          const isActive = state.name === current
          const Icon = state.icon
          return (
            <div key={state.name} className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 transition-all',
                    isActive
                      ? state.name === 'Degraded' ? 'border-destructive/40 bg-destructive/10 ring-2 ring-destructive/20'
                        : state.name === 'Elevated' ? 'border-primary/40 bg-primary/10 ring-2 ring-primary/20'
                        : 'border-success/40 bg-success/10 ring-2 ring-success/20'
                      : 'border-border bg-card',
                  )}>
                    <Icon className={cn(
                      'h-4 w-4',
                      isActive
                        ? state.name === 'Degraded' ? 'text-destructive'
                          : state.name === 'Elevated' ? 'text-primary'
                          : 'text-success'
                        : 'text-muted-foreground',
                    )} />
                    <div>
                      <p className={cn('text-xs font-bold', isActive ? '' : 'text-muted-foreground')}>{state.name}</p>
                      <p className="text-[10px] text-muted-foreground">{state.description}</p>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{state.detail}</TooltipContent>
              </Tooltip>
              {i < states.length - 1 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ConfigChangePreview({ current, pending }: { current: DiagnosticsOptions; pending: DiagnosticsOptions }) {
  const changes: { label: string; from: string; to: string; impact: 'up' | 'down' | 'neutral' }[] = []

  for (const key of Object.keys(pending.domains) as (keyof DiagnosticsOptions['domains'])[]) {
    const curLevel = current.domains[key]
    const newLevel = pending.domains[key]
    if (curLevel !== newLevel) {
      const curIdx = LEVEL_ORDER.indexOf(curLevel)
      const newIdx = LEVEL_ORDER.indexOf(newLevel)
      changes.push({
        label: `${DOMAIN_LABELS[key] ?? key} level`,
        from: LEVEL_LABELS[curLevel] ?? curLevel,
        to: LEVEL_LABELS[newLevel] ?? newLevel,
        impact: newIdx > curIdx ? 'up' : 'down',
      })
    }
  }
  if (current.defaultLevel !== pending.defaultLevel) {
    changes.push({ label: 'Default level', from: LEVEL_LABELS[current.defaultLevel] ?? current.defaultLevel, to: LEVEL_LABELS[pending.defaultLevel] ?? pending.defaultLevel, impact: 'neutral' })
  }
  if (current.storage.maxBytes !== pending.storage.maxBytes) {
    changes.push({ label: 'Storage limit', from: formatBytes(current.storage.maxBytes), to: formatBytes(pending.storage.maxBytes), impact: pending.storage.maxBytes > current.storage.maxBytes ? 'up' : 'down' })
  }
  if (current.storage.ttlHours !== pending.storage.ttlHours) {
    changes.push({ label: 'TTL', from: `${current.storage.ttlHours}h`, to: `${pending.storage.ttlHours}h`, impact: 'neutral' })
  }
  if (current.probe.diagTimeoutMs !== pending.probe.diagTimeoutMs) {
    changes.push({ label: 'Probe timeout', from: `${current.probe.diagTimeoutMs}ms`, to: `${pending.probe.diagTimeoutMs}ms`, impact: 'neutral' })
  }
  if (current.enabled !== pending.enabled) {
    changes.push({ label: 'Pipeline', from: current.enabled ? 'Enabled' : 'Disabled', to: pending.enabled ? 'Enabled' : 'Disabled', impact: pending.enabled ? 'up' : 'down' })
  }

  if (changes.length === 0) return null

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-bold text-warning">Pending changes ({changes.length})</h3>
        <span className="text-xs text-muted-foreground">Save to apply</span>
      </div>
      <div className="space-y-2">
        {changes.map((c) => (
          <div key={c.label} className="flex items-center gap-3 rounded-lg bg-card/50 px-3 py-2">
            <span className="w-36 shrink-0 text-xs font-medium">{c.label}</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{c.from}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className={cn('rounded px-2 py-0.5 text-xs font-medium',
              c.impact === 'up' ? 'bg-success/10 text-success' : c.impact === 'down' ? 'bg-warning/10 text-warning' : 'bg-muted text-foreground',
            )}>{c.to}</span>
            {c.impact === 'up' && <ArrowUpRight className="h-3 w-3 text-success" />}
            {c.impact === 'down' && <ArrowDownRight className="h-3 w-3 text-warning" />}
            {c.impact === 'neutral' && <Minus className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>
    </div>
  )
}
