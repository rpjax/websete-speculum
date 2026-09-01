/** Helpers for Telemetry configuration facilitated fields (engine wire: isEnabled). */

export type JsonObject = Record<string, unknown>

export const MIN_INTERVAL_SECONDS = 1
export const MAX_INTERVAL_SECONDS = 3600

export const INTERVAL_PRESETS = [
  { seconds: 10, label: '10s' },
  { seconds: 15, label: '15s' },
  { seconds: 30, label: '30s' },
  { seconds: 60, label: '1 min' },
  { seconds: 300, label: '5 min' },
] as const

export type TelemetrySectionKey =
  | 'host'
  | 'apiProcess'
  | 'sessions'
  | 'sidecar'
  | 'profiles'
  | 'journal'
  | 'docker'

export type TelemetrySectionMeta = {
  key: TelemetrySectionKey
  label: string
  helper: string
  defaultOn: boolean
}

export const TELEMETRY_SECTIONS: TelemetrySectionMeta[] = [
  {
    key: 'host',
    label: 'Host',
    helper: 'CPU, memory, and load on this machine.',
    defaultOn: true,
  },
  {
    key: 'apiProcess',
    label: 'API process',
    helper: 'Memory and GC pressure for the API.',
    defaultOn: true,
  },
  {
    key: 'sessions',
    label: 'Sessions',
    helper: 'How many live sessions are open (ids optional).',
    defaultOn: true,
  },
  {
    key: 'sidecar',
    label: 'Sidecar',
    helper: 'Browser sidecar health — Chrome, queues, allocations.',
    defaultOn: true,
  },
  {
    key: 'profiles',
    label: 'Profiles',
    helper: 'Profile store size and pressure.',
    defaultOn: true,
  },
  {
    key: 'journal',
    label: 'Journal',
    helper: 'Whether the Journal is falling behind.',
    defaultOn: true,
  },
  {
    key: 'docker',
    label: 'Docker',
    helper: 'Container runtime stats (off unless you need them).',
    defaultOn: false,
  },
]

export type TelemetrySamplerPresetId = 'off' | 'lean' | 'operable' | 'deep'

export type TelemetrySamplerPreset = {
  id: TelemetrySamplerPresetId
  label: string
  /** One short line under the mode name. */
  description: string
  /** Consequence line shown when this mode is active. */
  effect: string
  patch: JsonObject
}

const leanHost = {
  isEnabled: true,
  procPath: '/proc',
  diskPath: null,
  sampleIntervalMs: 1000,
  includeLoadAverage: true,
  includeSwap: true,
  includeDiskIo: false,
  includeNetwork: false,
}

const deepHost = {
  ...leanHost,
  includeDiskIo: true,
  includeNetwork: true,
}

const apiBaseline = {
  isEnabled: true,
  sampleIntervalMs: 1000,
  includePrivateMemory: true,
  includeGarbageCollection: true,
  includeThreadPool: true,
}

const sidecarBaseline = {
  isEnabled: true,
  includeProcess: true,
  includeEventLoop: true,
  includeChrome: true,
  includeQueues: true,
  includeSessionsSummary: true,
  includeFaultedIds: true,
  includeAllocationsSummary: true,
  includeAllocationSessions: false,
  timeoutMs: 2000,
}

export const TELEMETRY_PRESETS: TelemetrySamplerPreset[] = [
  {
    id: 'off',
    label: 'Off',
    description: 'Stop collecting.',
    effect: 'No samples. Section choices stay for later.',
    patch: { isEnabled: false },
  },
  {
    id: 'lean',
    label: 'Lean',
    description: 'Quiet everyday monitoring.',
    effect: 'Every minute · host, API, sessions · no Docker · no per-session rows.',
    patch: {
      isEnabled: true,
      intervalSeconds: 60,
      host: leanHost,
      apiProcess: apiBaseline,
      sessions: {
        isEnabled: true,
        includeSessionIds: false,
        includePerSession: false,
        includeUrlHost: true,
      },
      sidecar: { ...sidecarBaseline, isEnabled: true },
      profiles: { isEnabled: true, includeStorageBytes: true },
      journal: { isEnabled: true, includePressure: true },
      docker: {
        isEnabled: false,
        endpoint: 'unix:///var/run/docker.sock',
        includeRuntime: true,
        includeContainers: true,
        timeoutMs: 2000,
      },
    },
  },
  {
    id: 'operable',
    label: 'Operable',
    description: 'Production monitoring with identity.',
    effect: 'Every 30s · Docker on · session ids + URL hosts.',
    patch: {
      isEnabled: true,
      intervalSeconds: 30,
      host: { ...leanHost, procPath: '/host/proc' },
      apiProcess: apiBaseline,
      sessions: {
        isEnabled: true,
        includeSessionIds: true,
        includePerSession: false,
        includeUrlHost: true,
      },
      sidecar: { ...sidecarBaseline, timeoutMs: 5000 },
      profiles: { isEnabled: true, includeStorageBytes: true },
      journal: { isEnabled: true, includePressure: true },
      docker: {
        isEnabled: true,
        endpoint: 'unix:///var/run/docker.sock',
        includeRuntime: true,
        includeContainers: true,
        timeoutMs: 5000,
      },
    },
  },
  {
    id: 'deep',
    label: 'Deep',
    description: 'Full detail while debugging.',
    effect: 'Every 10s · disk + network · per-session rows · Docker on.',
    patch: {
      isEnabled: true,
      intervalSeconds: 10,
      host: { ...deepHost, procPath: '/host/proc' },
      apiProcess: apiBaseline,
      sessions: {
        isEnabled: true,
        includeSessionIds: true,
        includePerSession: true,
        includeUrlHost: true,
      },
      sidecar: { ...sidecarBaseline, timeoutMs: 5000 },
      profiles: { isEnabled: true, includeStorageBytes: true },
      journal: { isEnabled: true, includePressure: true },
      docker: {
        isEnabled: true,
        endpoint: 'unix:///var/run/docker.sock',
        includeRuntime: true,
        includeContainers: true,
        timeoutMs: 5000,
      },
    },
  },
]

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

export function sectionEnabled(value: JsonObject, key: TelemetrySectionKey): boolean {
  const child = asObject(value[key])
  if (typeof child.isEnabled === 'boolean') return child.isEnabled
  const meta = TELEMETRY_SECTIONS.find((section) => section.key === key)
  return meta?.defaultOn ?? true
}

export function clampIntervalSeconds(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 30
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.round(n)))
}

export function samplesPerHour(intervalSeconds: number): number {
  const interval = Math.max(1, intervalSeconds)
  return Math.round(3600 / interval)
}

export function applyTelemetryPreset(current: JsonObject, preset: TelemetrySamplerPreset): JsonObject {
  if (preset.id === 'off') {
    return { ...current, isEnabled: false }
  }
  const next: JsonObject = { ...current, ...preset.patch }
  for (const key of TELEMETRY_SECTIONS.map((section) => section.key)) {
    const patchChild = asObject(preset.patch[key])
    if (Object.keys(patchChild).length) {
      next[key] = { ...asObject(current[key]), ...patchChild }
    }
  }
  if (preset.patch.events == null && current.events != null) {
    next.events = current.events
  }
  return next
}

export function setAllSections(current: JsonObject, enabled: boolean): JsonObject {
  const next = { ...current }
  for (const section of TELEMETRY_SECTIONS) {
    next[section.key] = { ...asObject(current[section.key]), isEnabled: enabled }
  }
  return next
}

function formatIntervalLabel(intervalSeconds: number): string {
  if (intervalSeconds >= 60 && intervalSeconds % 60 === 0) {
    const minutes = intervalSeconds / 60
    return minutes === 1 ? '1 minute' : `${minutes} minutes`
  }
  return `${intervalSeconds}s`
}

export function summarizeTelemetry(value: JsonObject) {
  const enabled = Boolean(value.isEnabled)
  const intervalSeconds = clampIntervalSeconds(value.intervalSeconds ?? 30)
  const activeSections = TELEMETRY_SECTIONS.filter((section) => sectionEnabled(value, section.key))
  const events =
    value.events && typeof value.events === 'object' && !Array.isArray(value.events)
      ? (value.events as Record<string, boolean>)
      : {}
  const eventOptIns = Object.values(events).filter(Boolean).length
  const intervalLabel = formatIntervalLabel(intervalSeconds)
  const sectionList =
    activeSections.length === 0
      ? 'no sections'
      : activeSections.length <= 3
        ? activeSections.map((section) => section.label).join(', ')
        : `${activeSections
            .slice(0, 2)
            .map((section) => section.label)
            .join(', ')} +${activeSections.length - 2} more`
  return {
    enabled,
    intervalSeconds,
    intervalLabel,
    samplesPerHour: samplesPerHour(intervalSeconds),
    activeSectionCount: activeSections.length,
    totalSections: TELEMETRY_SECTIONS.length,
    activeSectionLabels: activeSections.map((section) => section.label),
    eventOptIns,
    statusLabel: enabled
      ? `On · every ${intervalLabel} · ${activeSections.length}/${TELEMETRY_SECTIONS.length} sections`
      : 'Sampler off',
    statusNarrative: enabled
      ? `Collecting a sample every ${intervalLabel} from ${sectionList}.`
      : 'Not collecting samples. Turn the sampler on or pick a preset to start.',
  }
}

export function describeSectionDetail(value: JsonObject, key: TelemetrySectionKey): string {
  const child = asObject(value[key])
  switch (key) {
    case 'host': {
      const bits = [
        child.includeLoadAverage !== false ? 'load' : null,
        child.includeSwap !== false ? 'swap' : null,
        child.includeDiskIo ? 'disk I/O' : null,
        child.includeNetwork ? 'network' : null,
      ].filter(Boolean)
      return bits.length ? bits.join(' · ') : 'Minimal host fields'
    }
    case 'apiProcess': {
      const bits = [
        child.includePrivateMemory !== false ? 'memory' : null,
        child.includeGarbageCollection !== false ? 'GC' : null,
        child.includeThreadPool !== false ? 'thread pool' : null,
      ].filter(Boolean)
      return bits.length ? bits.join(' · ') : 'Minimal process fields'
    }
    case 'sessions': {
      const bits = [
        child.includeSessionIds ? 'ids' : null,
        child.includeUrlHost ? 'URL host' : null,
        child.includePerSession ? 'per-session' : null,
      ].filter(Boolean)
      return bits.length ? `Identity: ${bits.join(' · ')}` : 'Aggregate only'
    }
    case 'sidecar': {
      const bits = [
        child.includeProcess !== false ? 'process' : null,
        child.includeChrome !== false ? 'Chrome' : null,
        child.includeQueues !== false ? 'queues' : null,
        child.includeSessionsSummary !== false ? 'sessions' : null,
      ].filter(Boolean)
      return bits.length ? bits.join(' · ') : 'Minimal sidecar fields'
    }
    case 'profiles':
      return child.includeStorageBytes !== false ? 'Includes storage bytes' : 'Counts only'
    case 'journal':
      return child.includePressure !== false ? 'Includes pressure' : 'Enabled without pressure detail'
    case 'docker': {
      const bits = [
        child.includeRuntime !== false ? 'runtime' : null,
        child.includeContainers !== false ? 'containers' : null,
      ].filter(Boolean)
      return bits.length ? bits.join(' · ') : 'Enabled'
    }
    default:
      return ''
  }
}

function sectionFlagsMatch(current: JsonObject, expected: JsonObject, key: TelemetrySectionKey): boolean {
  const a = asObject(current[key])
  const b = asObject(expected[key])
  if (Object.keys(b).length === 0) return true
  if (Boolean(a.isEnabled) !== Boolean(b.isEnabled)) return false
  for (const [field, want] of Object.entries(b)) {
    if (field === 'isEnabled') continue
    if (field === 'procPath' || field === 'diskPath' || field === 'endpoint') continue
    if (field === 'sampleIntervalMs' || field === 'timeoutMs') continue
    if (a[field] !== want) return false
  }
  return true
}

/** Which guided mode matches the current draft, or `custom` when none fit. */
export function matchTelemetryPreset(value: JsonObject): TelemetrySamplerPresetId | 'custom' {
  if (!value.isEnabled) return 'off'
  for (const preset of TELEMETRY_PRESETS) {
    if (preset.id === 'off') continue
    const patch = preset.patch
    if (clampIntervalSeconds(value.intervalSeconds) !== clampIntervalSeconds(patch.intervalSeconds)) {
      continue
    }
    const sectionsOk = TELEMETRY_SECTIONS.every((section) => sectionFlagsMatch(value, patch, section.key))
    if (sectionsOk) return preset.id
  }
  return 'custom'
}
