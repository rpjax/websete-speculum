import type {
  DiagnosticsCapability,
  DiagnosticsOptions,
  DiagnosticsProfile,
  EffectiveCapabilities,
} from '@/lib/diagnosticsApi'

/**
 * Canonical event/effective-capability domain keys (DiagnosticsDomain.ToString() on the wire).
 * These are the strings the API emits for event `domain` and effectiveCapabilities keys.
 */
export const EVENT_DOMAINS = [
  'MotorLive',
  'SidecarBrowser',
  'BrowserQuery',
  'PersistedSessions',
  'Telemetry',
  'DiagnosticsSelf',
] as const

export const DOMAIN_COLORS: Record<string, string> = {
  MotorLive: 'text-blue-400',
  SidecarBrowser: 'text-purple-400',
  BrowserQuery: 'text-violet-400',
  PersistedSessions: 'text-teal-400',
  Telemetry: 'text-amber-400',
  DiagnosticsSelf: 'text-orange-400',
}

export const DOMAIN_BG: Record<string, string> = {
  MotorLive: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  SidecarBrowser: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  BrowserQuery: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  PersistedSessions: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  Telemetry: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  DiagnosticsSelf: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

export const DOMAIN_LABELS: Record<string, string> = {
  MotorLive: 'Motor (sessions)',
  SidecarBrowser: 'Sidecar (browser)',
  BrowserQuery: 'Browser Query',
  PersistedSessions: 'Persisted Sessions',
  Telemetry: 'Telemetry',
  DiagnosticsSelf: 'Diagnostics',
}

export const DOMAIN_DESCRIPTIONS: Record<string, string> = {
  MotorLive: 'Session lifecycle, navigation, slot management, sidecar connect/fault, state export',
  SidecarBrowser: 'Browser probe requests, completions, timeouts, rejections',
  BrowserQuery: 'Cookie, storage, DOM, and JS evaluation operations',
  PersistedSessions: 'Persisted session detail queries and state exports',
  Telemetry: 'Composite periodic snapshot — host, motor, sidecar, persistence, pipeline',
  DiagnosticsSelf: 'Config changes, elevate, degrade, recover, storage overflow, cleanup',
}

/** Config toggle-group labels (DiagnosticsDomainToggles keys). */
export const CONFIG_DOMAIN_LABELS: Record<string, string> = {
  motor: 'Motor (sessions)',
  sidecar: 'Sidecar (browser)',
  browserQuery: 'Browser Query',
  persisted: 'Persisted Sessions',
}

export const CAPABILITY_ORDER: DiagnosticsCapability[] = ['Metric', 'Event', 'Snapshot', 'Probe']

export const CAPABILITY_LABELS: Record<string, string> = {
  Metric: 'Metrics',
  Event: 'Events',
  Snapshot: 'Snapshots',
  Probe: 'Browser Query',
}

export const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
  Metric: 'Gauges and counters (FPS, capacity, back-pressure) — survives degraded mode',
  Event: 'Lifecycle events recorded to the timeline',
  Snapshot: 'Full state snapshots persisted on export',
  Probe: 'Browser interrogation (cookies, DOM, evaluate) — deep inspection',
}

/**
 * Diagnostics presets = pre-applied toggle bundles. Mirrors DiagnosticsSeedProfiles on the API
 * (docs/diagnostics.md). Selecting a profile applies these toggles; individual toggles override.
 */
export const DIAGNOSTICS_PRESETS: Record<DiagnosticsProfile, Pick<DiagnosticsOptions, 'domains' | 'telemetry'>> = {
  Development: {
    domains: {
      motor: { metrics: true, events: true, snapshots: true },
      sidecar: { metrics: true, events: true },
      browserQuery: { probe: true },
      persisted: { snapshots: true },
    },
    telemetry: {
      enabled: true,
      intervalSeconds: 15,
      host: { enabled: true },
      motor: { enabled: true, includeSessionIds: true, includePerSession: true, includeUrlHost: true },
      sidecar: { enabled: true, includeFaultedIds: true },
      persistence: { enabled: true, includeBytes: true },
      pipeline: { enabled: true, includeBreakerPressure: true },
    },
  },
  Production: {
    domains: {
      motor: { metrics: true, events: true, snapshots: true },
      sidecar: { metrics: true, events: false },
      browserQuery: { probe: false },
      persisted: { snapshots: true },
    },
    telemetry: {
      enabled: true,
      intervalSeconds: 30,
      host: { enabled: true },
      motor: { enabled: true, includeSessionIds: false, includePerSession: false, includeUrlHost: false },
      sidecar: { enabled: true, includeFaultedIds: false },
      persistence: { enabled: true, includeBytes: false },
      pipeline: { enabled: true, includeBreakerPressure: false },
    },
  },
  Assertive: {
    domains: {
      motor: { metrics: true, events: true, snapshots: true },
      sidecar: { metrics: true, events: true },
      browserQuery: { probe: true },
      persisted: { snapshots: true },
    },
    telemetry: {
      enabled: true,
      intervalSeconds: 10,
      host: { enabled: true },
      motor: { enabled: true, includeSessionIds: true, includePerSession: true, includeUrlHost: true },
      sidecar: { enabled: true, includeFaultedIds: true },
      persistence: { enabled: true, includeBytes: true },
      pipeline: { enabled: true, includeBreakerPressure: true },
    },
  },
}

/** Enabled capability names for a domain's effective map, plus an "off" (nothing enabled) flag. */
export function summarizeCapabilities(
  caps: Partial<Record<string, boolean>> | undefined,
): { enabled: string[]; off: boolean } {
  const enabled = Object.entries(caps ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k)
  return { enabled, off: enabled.length === 0 }
}

/** Count individual capability toggles across all domains (for the health heuristic). */
export function countCapabilities(effective: EffectiveCapabilities | undefined): {
  off: number
  total: number
  enabled: number
} {
  let off = 0
  let total = 0
  for (const caps of Object.values(effective ?? {})) {
    for (const v of Object.values(caps)) {
      total++
      if (!v) off++
    }
  }
  return { off, total, enabled: total - off }
}

export const SEVERITY_COLORS: Record<string, string> = {
  Information: 'text-blue-400',
  Info: 'text-blue-400',
  Warning: 'text-warning',
  Error: 'text-destructive',
  Metric: 'text-muted-foreground',
}

export const SEVERITY_BG: Record<string, string> = {
  Information: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Warning: 'bg-warning/15 text-warning border-warning/30',
  Error: 'bg-destructive/15 text-destructive border-destructive/30',
  Metric: 'bg-muted text-muted-foreground border-border',
}

export type StoryType = 'session-lifecycle' | 'navigation' | 'probe' | 'drain' | 'state-export' | 'admin' | 'unknown'

export const STORY_TYPES: Record<StoryType, { label: string; patterns: string[] }> = {
  'session-lifecycle': { label: 'Session lifecycle', patterns: ['Motor.Session', 'Motor.Slot', 'Motor.Sidecar'] },
  'navigation': { label: 'Navigation', patterns: ['Motor.Navigate', 'Motor.UrlMapped', 'Motor.Resize'] },
  'probe': { label: 'Browser probe', patterns: ['Sidecar.DiagProbe'] },
  'drain': { label: 'Session drain', patterns: ['Motor.Drain'] },
  'state-export': { label: 'State export', patterns: ['Motor.StateExport'] },
  'admin': { label: 'Admin action', patterns: ['Diagnostics.'] },
  'unknown': { label: 'Activity', patterns: [] },
}

export const PROBE_OPS = [
  { id: 'process', label: 'Process info', capability: 'Metric', description: 'Browser PID and process type' },
  { id: 'tabs', label: 'Open tabs', capability: 'Metric', description: 'List of open browser tabs' },
  { id: 'resources', label: 'Resources', capability: 'Metric', description: 'JS heap usage and memory' },
  { id: 'export', label: 'State export', capability: 'Metric', description: 'Trigger browser state export' },
  { id: 'cookies', label: 'Cookies', capability: 'Probe', description: 'All cookies from browser context' },
  { id: 'storage', label: 'Local storage', capability: 'Probe', description: 'localStorage entries' },
  { id: 'dom', label: 'DOM query', capability: 'Probe', description: 'DOM snapshot via selector' },
  { id: 'evaluate', label: 'JS evaluate', capability: 'Probe', description: 'JavaScript expression evaluation' },
] as const

export const PROBE_QUICK_PICKS = [
  { id: 'health', label: 'Session health', ops: ['process', 'tabs', 'resources'], capability: 'Metric', description: 'Quick health check: process, tabs, resources' },
  { id: 'browser-state', label: 'Browser state', ops: ['cookies', 'storage'], capability: 'Probe', description: 'Cookies and localStorage (requires Browser Query)' },
  { id: 'performance', label: 'Performance', ops: ['resources', 'process'], capability: 'Metric', description: 'CPU and memory metrics' },
  { id: 'full', label: 'Full inspection', ops: ['process', 'tabs', 'resources', 'cookies', 'storage'], capability: 'Probe', description: 'Complete session inspection' },
] as const

export function detectStoryType(eventNames: string[]): StoryType {
  for (const [type, config] of Object.entries(STORY_TYPES) as [StoryType, { label: string; patterns: string[] }][]) {
    if (type === 'unknown') continue
    if (config.patterns.some((p) => eventNames.some((n) => n.startsWith(p)))) return type
  }
  return 'unknown'
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes < 60) return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

export function formatRelativeTime(utc: string): string {
  const diff = Date.now() - new Date(utc).getTime()
  if (diff < 0) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
