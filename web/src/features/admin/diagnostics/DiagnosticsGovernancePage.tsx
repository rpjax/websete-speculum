import { useCallback, useEffect, useState, useRef } from 'react'
import {
  diagnosticsApi,
  type DiagnosticsOverview,
  type DiagnosticsOptions,
  type DiagnosticsProfile,
} from '@/lib/diagnosticsApi'
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
  DOMAIN_LABELS, CONFIG_DOMAIN_LABELS, CAPABILITY_LABELS, CAPABILITY_DESCRIPTIONS,
  DIAGNOSTICS_PRESETS, summarizeCapabilities,
  formatBytes, formatRelativeTime, DOMAIN_COLORS,
} from '@/lib/diagnosticsConstants'
import { humanizeDomain } from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'
import {
  Info, Save, RotateCcw, Layers, Eye, EyeOff, ShieldCheck,
  ShieldAlert, Zap, ArrowRight, HardDrive, Clock, Settings,
  Gauge, FlaskConical, Activity, BookOpen, HelpCircle,
  Upload, FileJson, AlertTriangle, Radar,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react'

const DEFAULT_CONFIG: DiagnosticsOptions = {
  enabled: true,
  profile: 'Production',
  domains: DIAGNOSTICS_PRESETS.Production.domains,
  telemetry: DIAGNOSTICS_PRESETS.Production.telemetry,
  storage: { maxBytes: 64 * 1024 * 1024, maxEventsPerSession: 5000, ttlHours: 24, overflow: 'DropOldest' },
  sampling: { statusMirrorRatio: 1, expensiveEventRatio: 0.25 },
  elevate: { browserQueryMaxMinutes: 30 },
  probe: { diagTimeoutMs: 10_000, maxConcurrentProbesPerSession: 2, maxProbeResponseBytes: 512 * 1024, hostSampleIntervalMs: 1000 },
}

// Each config toggle-group maps to an effective-capability domain (the wire enum key).
const DOMAIN_GROUPS = [
  { group: 'motor', effectiveKey: 'MotorLive' },
  { group: 'sidecar', effectiveKey: 'SidecarBrowser' },
  { group: 'browserQuery', effectiveKey: 'BrowserQuery' },
  { group: 'persisted', effectiveKey: 'PersistedSessions' },
] as const

const PROFILES: DiagnosticsProfile[] = ['Development', 'Production', 'Assertive']

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

  function applyProfile(profile: DiagnosticsProfile) {
    const preset = DIAGNOSTICS_PRESETS[profile]
    setConfig({ ...config, profile, domains: preset.domains, telemetry: preset.telemetry })
  }

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
      setMessage('Reset to defaults — all capabilities, storage, and probe settings restored.')
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
            Pick a <strong>profile</strong> for a sensible baseline, then toggle individual capabilities per domain.
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

      {/* Profile preset */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Profile</h3>
          <Tooltip>
            <TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60" /></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              A profile is a pre-applied bundle of capability and telemetry toggles. Selecting one applies its
              baseline — you can still tune individual toggles below before saving.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-3 p-5">
          <Select value={config.profile} onValueChange={(v) => applyProfile(v as DiagnosticsProfile)}>
            <SelectTrigger className="h-9 w-52 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROFILES.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Applies the {config.profile} baseline of capability + telemetry toggles. Individual toggles override the preset.
          </p>
        </div>
      </div>

      {/* Domain capabilities */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Domain capabilities</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm text-xs">
              Each domain exposes capability toggles. The <strong>configured</strong> switch is what you set here;
              the <strong>effective</strong> badge is what's actually applied (may differ during elevation or degradation).
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="p-5 space-y-4">
          {/* Capability legend */}
          <div className="rounded-lg border border-border/50 bg-muted/10 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Capability reference</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(['Metric', 'Event', 'Snapshot', 'Probe'] as const).map((cap) => (
                <div key={cap} className="rounded-md bg-muted/20 px-3 py-2">
                  <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">{CAPABILITY_LABELS[cap]}</span>
                  <p className="mt-1 text-[10px] text-muted-foreground leading-tight">{CAPABILITY_DESCRIPTIONS[cap]}</p>
                </div>
              ))}
            </div>
          </div>

          {DOMAIN_GROUPS.map(({ group, effectiveKey }) => {
            const iconColor = DOMAIN_COLORS[effectiveKey] ?? 'text-muted-foreground'
            const eff = overview?.effectiveCapabilities[effectiveKey]
            const effSummary = summarizeCapabilities(eff)
            return (
              <div key={group} className="rounded-lg border border-border/50 p-4">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className={cn('shrink-0', iconColor)}>
                    {effSummary.off ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{CONFIG_DOMAIN_LABELS[group] ?? DOMAIN_LABELS[effectiveKey] ?? group}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{humanizeDomain(effectiveKey)}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <DomainCapabilityRows
                    group={group}
                    config={config}
                    effective={eff}
                    onChange={setConfig}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Telemetry */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <Radar className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Telemetry</h3>
          <Tooltip>
            <TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60" /></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              The composite periodic sample overlays host × motor × sidecar × persistence × pipeline on one time axis.
              Each section and identity opt-in is toggled independently.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/20 px-4 py-3">
            <Switch
              id="tel-enabled"
              checked={config.telemetry.enabled}
              onCheckedChange={(enabled) => setConfig({ ...config, telemetry: { ...config.telemetry, enabled } })}
            />
            <Label htmlFor="tel-enabled" className="text-sm font-medium">Telemetry sampler enabled</Label>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Interval (s)</Label>
              <Input
                type="number"
                className="h-8 w-20 text-xs"
                value={config.telemetry.intervalSeconds}
                onChange={(e) => setConfig({ ...config, telemetry: { ...config.telemetry, intervalSeconds: Number(e.target.value) } })}
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <TelemetryToggle label="Host" description="CPU, memory, GC, thread pool, disk"
              checked={config.telemetry.host.enabled}
              onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, host: { enabled: v } } })} />
            <TelemetryToggle label="Motor" description="Live-session aggregates (fps, capacity, queues)"
              checked={config.telemetry.motor.enabled}
              onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, motor: { ...config.telemetry.motor, enabled: v } } })} />
            <TelemetryToggle label="Sidecar" description="Connectivity aggregate (connected / faulted)"
              checked={config.telemetry.sidecar.enabled}
              onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, sidecar: { ...config.telemetry.sidecar, enabled: v } } })} />
            <TelemetryToggle label="Persistence" description="Stored session footprint (cookies, history)"
              checked={config.telemetry.persistence.enabled}
              onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, persistence: { ...config.telemetry.persistence, enabled: v } } })} />
            <TelemetryToggle label="Pipeline" description="Diagnostics back-pressure (bytes, drops)"
              checked={config.telemetry.pipeline.enabled}
              onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, pipeline: { ...config.telemetry.pipeline, enabled: v } } })} />
          </div>

          <Accordion type="single" collapsible>
            <AccordionItem value="tel-identity" className="border-border/50">
              <AccordionTrigger className="text-xs font-semibold text-muted-foreground hover:no-underline">
                Identity opt-ins (per-section detail)
              </AccordionTrigger>
              <AccordionContent className="grid gap-2 pt-2 sm:grid-cols-2">
                <TelemetryToggle label="Motor · session IDs" description="Include live session IDs in the sample"
                  checked={config.telemetry.motor.includeSessionIds}
                  onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, motor: { ...config.telemetry.motor, includeSessionIds: v } } })} />
                <TelemetryToggle label="Motor · per-session" description="Include per-session projections"
                  checked={config.telemetry.motor.includePerSession}
                  onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, motor: { ...config.telemetry.motor, includePerSession: v } } })} />
                <TelemetryToggle label="Motor · URL host" description="Include the host of the current URL"
                  checked={config.telemetry.motor.includeUrlHost}
                  onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, motor: { ...config.telemetry.motor, includeUrlHost: v } } })} />
                <TelemetryToggle label="Sidecar · faulted IDs" description="Include faulted session IDs"
                  checked={config.telemetry.sidecar.includeFaultedIds}
                  onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, sidecar: { ...config.telemetry.sidecar, includeFaultedIds: v } } })} />
                <TelemetryToggle label="Persistence · store bytes" description="Include on-disk store size"
                  checked={config.telemetry.persistence.includeBytes}
                  onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, persistence: { ...config.telemetry.persistence, includeBytes: v } } })} />
                <TelemetryToggle label="Pipeline · breaker pressure" description="Include recent drops / slow writes"
                  checked={config.telemetry.pipeline.includeBreakerPressure}
                  onChange={(v) => setConfig({ ...config, telemetry: { ...config.telemetry, pipeline: { ...config.telemetry.pipeline, includeBreakerPressure: v } } })} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
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
            <ResourceGauge label="Byte limit" used={overview.bytesUsed} total={overview.storageMaxBytes} formatValue={formatBytes} />
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
                tooltip="Minimum interval between host resource samples (CPU, memory, GC). The Telemetry sampler reuses this cache."
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
                tooltip="Maximum allowed duration for a Browser Query elevation. After this, the elevation automatically expires." />
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

/** Renders the configured switches + effective badges for one domain group. */
function DomainCapabilityRows({ group, config, effective, onChange }: {
  group: (typeof DOMAIN_GROUPS)[number]['group']
  config: DiagnosticsOptions
  effective: Partial<Record<string, boolean>> | undefined
  onChange: (next: DiagnosticsOptions) => void
}) {
  const rows: { field: string; capability: string; configured: boolean; set: (v: boolean) => void }[] = []
  const d = config.domains

  if (group === 'motor') {
    rows.push(
      { field: 'metrics', capability: 'Metric', configured: d.motor.metrics, set: (v) => onChange({ ...config, domains: { ...d, motor: { ...d.motor, metrics: v } } }) },
      { field: 'events', capability: 'Event', configured: d.motor.events, set: (v) => onChange({ ...config, domains: { ...d, motor: { ...d.motor, events: v } } }) },
      { field: 'snapshots', capability: 'Snapshot', configured: d.motor.snapshots, set: (v) => onChange({ ...config, domains: { ...d, motor: { ...d.motor, snapshots: v } } }) },
    )
  } else if (group === 'sidecar') {
    rows.push(
      { field: 'metrics', capability: 'Metric', configured: d.sidecar.metrics, set: (v) => onChange({ ...config, domains: { ...d, sidecar: { ...d.sidecar, metrics: v } } }) },
      { field: 'events', capability: 'Event', configured: d.sidecar.events, set: (v) => onChange({ ...config, domains: { ...d, sidecar: { ...d.sidecar, events: v } } }) },
    )
  } else if (group === 'browserQuery') {
    rows.push(
      { field: 'probe', capability: 'Probe', configured: d.browserQuery.probe, set: (v) => onChange({ ...config, domains: { ...d, browserQuery: { probe: v } } }) },
    )
  } else {
    rows.push(
      { field: 'snapshots', capability: 'Snapshot', configured: d.persisted.snapshots, set: (v) => onChange({ ...config, domains: { ...d, persisted: { snapshots: v } } }) },
    )
  }

  return (
    <>
      {rows.map((row) => {
        const effOn = effective?.[row.capability] ?? false
        const mismatch = effOn !== row.configured
        return (
          <div key={row.field} className="flex items-center gap-3 rounded-md bg-muted/10 px-3 py-2">
            <Switch checked={row.configured} onCheckedChange={row.set} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{CAPABILITY_LABELS[row.capability] ?? row.capability}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">{CAPABILITY_DESCRIPTIONS[row.capability]}</p>
            </div>
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
              effOn ? 'bg-blue-500/10 text-blue-400' : 'bg-muted text-muted-foreground',
            )}>
              {effOn ? 'Effective' : 'Off'}
            </span>
            {mismatch && (
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-3 w-3 text-warning" /></TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  The effective capability differs from configured because of elevation or degradation.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )
      })}
    </>
  )
}

function TelemetryToggle({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md bg-muted/10 px-3 py-2">
      <Switch checked={checked} onCheckedChange={onChange} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground leading-tight">{description}</p>
      </div>
    </label>
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
    { name: 'Normal', icon: ShieldCheck, description: 'All capabilities active', detail: 'Full diagnostics capability — all configured toggles are in effect.' },
    { name: 'Elevated', icon: Zap, description: 'Browser Query unlocked', detail: 'Temporary deep inspection — cookie, DOM, and JS access is enabled.' },
    { name: 'Degraded', icon: ShieldAlert, description: 'Circuit breaker tripped', detail: 'Capped at Metric due to errors — manual recovery needed.' },
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

  function diffToggle(label: string, from: boolean, to: boolean) {
    if (from !== to) changes.push({ label, from: from ? 'On' : 'Off', to: to ? 'On' : 'Off', impact: to ? 'up' : 'down' })
  }

  diffToggle('Motor · Metrics', current.domains.motor.metrics, pending.domains.motor.metrics)
  diffToggle('Motor · Events', current.domains.motor.events, pending.domains.motor.events)
  diffToggle('Motor · Snapshots', current.domains.motor.snapshots, pending.domains.motor.snapshots)
  diffToggle('Sidecar · Metrics', current.domains.sidecar.metrics, pending.domains.sidecar.metrics)
  diffToggle('Sidecar · Events', current.domains.sidecar.events, pending.domains.sidecar.events)
  diffToggle('Browser Query · Probe', current.domains.browserQuery.probe, pending.domains.browserQuery.probe)
  diffToggle('Persisted · Snapshots', current.domains.persisted.snapshots, pending.domains.persisted.snapshots)
  diffToggle('Telemetry', current.telemetry.enabled, pending.telemetry.enabled)

  if (current.profile !== pending.profile) {
    changes.push({ label: 'Profile', from: current.profile, to: pending.profile, impact: 'neutral' })
  }
  if (current.telemetry.intervalSeconds !== pending.telemetry.intervalSeconds) {
    changes.push({ label: 'Telemetry interval', from: `${current.telemetry.intervalSeconds}s`, to: `${pending.telemetry.intervalSeconds}s`, impact: 'neutral' })
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
            <span className="w-40 shrink-0 text-xs font-medium">{c.label}</span>
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
