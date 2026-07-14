export const DOMAIN_COLORS: Record<string, string> = {
  'Motor.Live': 'text-blue-400',
  'Sidecar.Browser': 'text-purple-400',
  'BrowserQuery': 'text-violet-400',
  'Persistence': 'text-teal-400',
  'HostResources': 'text-amber-400',
  'Diagnostics.Self': 'text-orange-400',
}

export const DOMAIN_BG: Record<string, string> = {
  'Motor.Live': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'Sidecar.Browser': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'BrowserQuery': 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  'Persistence': 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  'HostResources': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Diagnostics.Self': 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

export const DOMAIN_LABELS: Record<string, string> = {
  motorLive: 'Motor (sessions)',
  sidecarBrowser: 'Sidecar (browser)',
  browserQuery: 'Browser Query',
  persistedSessions: 'Persisted Sessions',
  hostResources: 'Host Resources',
  'Motor.Live': 'Motor (sessions)',
  'Sidecar.Browser': 'Sidecar (browser)',
  'BrowserQuery': 'Browser Query',
  'Persistence': 'Persisted Sessions',
  'HostResources': 'Host Resources',
  'Diagnostics.Self': 'Diagnostics',
}

export const DOMAIN_DESCRIPTIONS: Record<string, string> = {
  'Motor.Live': 'Session lifecycle, navigation, slot management, sidecar connect/fault, state export',
  'Sidecar.Browser': 'Browser probe requests, completions, timeouts, rejections',
  'BrowserQuery': 'Cookie, storage, DOM, and JS evaluation operations',
  'Persistence': 'Persisted session detail queries and state exports',
  'HostResources': '.NET process metrics (memory, GC, threads)',
  'Diagnostics.Self': 'Config changes, elevate, degrade, recover, storage overflow, cleanup',
}

export const LEVEL_ORDER = ['Off', 'Metrics', 'Events', 'StateSnapshots', 'BrowserQuery'] as const

export const LEVEL_LABELS: Record<string, string> = {
  Off: 'Off',
  Metrics: 'Metrics',
  Events: 'Events',
  StateSnapshots: 'Snapshots',
  BrowserQuery: 'Browser Query',
}

export const LEVEL_DESCRIPTIONS: Record<string, string> = {
  Off: 'No signals collected for this domain',
  Metrics: 'Gauges and counters only (FPS, frame count, memory)',
  Events: 'Lifecycle events recorded to the timeline',
  StateSnapshots: 'Full state snapshots persisted on export',
  BrowserQuery: 'Browser interrogation enabled (cookies, DOM, evaluate)',
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
  { id: 'process', label: 'Process info', level: 'Metrics', description: 'Browser PID and process type' },
  { id: 'tabs', label: 'Open tabs', level: 'Metrics', description: 'List of open browser tabs' },
  { id: 'resources', label: 'Resources', level: 'Metrics', description: 'JS heap usage and memory' },
  { id: 'export', label: 'State export', level: 'Metrics', description: 'Trigger browser state export' },
  { id: 'cookies', label: 'Cookies', level: 'BrowserQuery', description: 'All cookies from browser context' },
  { id: 'storage', label: 'Local storage', level: 'BrowserQuery', description: 'localStorage entries' },
  { id: 'dom', label: 'DOM query', level: 'BrowserQuery', description: 'DOM snapshot via selector' },
  { id: 'evaluate', label: 'JS evaluate', level: 'BrowserQuery', description: 'JavaScript expression evaluation' },
] as const

export const PROBE_QUICK_PICKS = [
  { id: 'health', label: 'Session health', ops: ['process', 'tabs', 'resources'], level: 'Metrics', description: 'Quick health check: process, tabs, resources' },
  { id: 'browser-state', label: 'Browser state', ops: ['cookies', 'storage'], level: 'BrowserQuery', description: 'Cookies and localStorage (requires BrowserQuery level)' },
  { id: 'performance', label: 'Performance', ops: ['resources', 'process'], level: 'Metrics', description: 'CPU and memory metrics' },
  { id: 'full', label: 'Full inspection', ops: ['process', 'tabs', 'resources', 'cookies', 'storage'], level: 'BrowserQuery', description: 'Complete session inspection' },
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
