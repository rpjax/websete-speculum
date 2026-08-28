/** Helpers for ResourceManagement facilitated fields (GiB, .NET TimeSpan strings). */

export const GIB = 1024 ** 3
export const KIB = 1024

export type JsonObject = Record<string, unknown>

export type ResourceCapacityPresetId = 'lab' | 'dev' | 'small-prod'

export type ResourceCapacityPreset = {
  id: ResourceCapacityPresetId
  label: string
  description: string
  sessions: {
    maxConcurrentSessions: number
    maxConcurrentSessionsPerProfile: number
    maxPipesPerSession: number
    maxSessionDuration: string
  }
  storage: {
    budgetBytes: number
  }
}

export const CAPACITY_PRESETS: ResourceCapacityPreset[] = [
  {
    id: 'lab',
    label: 'Lab',
    description: 'Single-slot local workbench.',
    sessions: {
      maxConcurrentSessions: 1,
      maxConcurrentSessionsPerProfile: 1,
      maxPipesPerSession: 2,
      maxSessionDuration: '04:00:00',
    },
    storage: { budgetBytes: 2 * GIB },
  },
  {
    id: 'dev',
    label: 'Dev host',
    description: 'A few concurrent sessions for shared testing.',
    sessions: {
      maxConcurrentSessions: 4,
      maxConcurrentSessionsPerProfile: 2,
      maxPipesPerSession: 4,
      maxSessionDuration: '08:00:00',
    },
    storage: { budgetBytes: 5 * GIB },
  },
  {
    id: 'small-prod',
    label: 'Small production',
    description: 'Modest admission and retention headroom.',
    sessions: {
      maxConcurrentSessions: 8,
      maxConcurrentSessionsPerProfile: 4,
      maxPipesPerSession: 8,
      maxSessionDuration: '1.00:00:00',
    },
    storage: { budgetBytes: 10 * GIB },
  },
]

export const STORAGE_BUDGET_PRESETS_GIB = [1, 2, 5, 10, 20] as const

export const SESSION_DURATION_PRESETS = [
  { id: 'unlimited', label: 'No limit', value: '00:00:00' },
  { id: '1h', label: '1 hour', value: '01:00:00' },
  { id: '4h', label: '4 hours', value: '04:00:00' },
  { id: '8h', label: '8 hours', value: '08:00:00' },
  { id: '24h', label: '24 hours', value: '1.00:00:00' },
] as const

export const RETENTION_DAY_PRESETS = [7, 14, 30, 90] as const

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

export function nestedNumber(section: JsonObject, parent: string, key: string): number {
  const raw = asObject(section[parent])[key]
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function nestedText(section: JsonObject, parent: string, key: string): string {
  const raw = asObject(section[parent])[key]
  if (typeof raw === 'string') return raw
  if (raw == null) return ''
  return String(raw)
}

export function bytesToGibInput(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const gib = bytes / GIB
  return Number.isInteger(gib) || Math.abs(gib - Math.round(gib)) < 1e-9
    ? String(Math.round(gib))
    : gib.toFixed(1)
}

export function gibInputToBytes(raw: string): number {
  const gib = Number(raw)
  if (!Number.isFinite(gib) || gib <= 0) return 0
  return Math.round(gib * GIB)
}

export function formatGibLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Not set'
  const gib = bytes / GIB
  const rounded = gib >= 10 ? gib.toFixed(0) : gib.toFixed(gib % 1 === 0 ? 0 : 1)
  return `${rounded} GiB`
}

export function formatKiBLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Not set'
  return `${Math.round(bytes / KIB)} KiB`
}

export type ParsedTimeSpan = {
  days: number
  hours: number
  minutes: number
  seconds: number
  totalSeconds: number
}

/** Parse .NET TimeSpan JSON (`HH:mm:ss` or `d.HH:mm:ss`). */
export function parseDotNetTimeSpan(raw: string): ParsedTimeSpan | null {
  const value = raw.trim()
  if (!value) return null
  const match = /^(-?)(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(value)
  if (!match) return null
  const sign = match[1] === '-' ? -1 : 1
  const days = Number(match[2] ?? 0)
  const hours = Number(match[3])
  const minutes = Number(match[4])
  const seconds = Number(match[5])
  if ([days, hours, minutes, seconds].some((n) => !Number.isFinite(n))) return null
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  const totalSeconds = sign * (((days * 24 + hours) * 60 + minutes) * 60 + seconds)
  return { days, hours, minutes, seconds, totalSeconds }
}

export function formatDotNetTimeSpan(days: number, hours: number, minutes: number, seconds = 0): string {
  const d = Math.max(0, Math.floor(days))
  const h = Math.max(0, Math.floor(hours))
  const m = Math.max(0, Math.floor(minutes))
  const s = Math.max(0, Math.floor(seconds))
  const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return d > 0 ? `${d}.${clock}` : clock
}

export function timeSpanFromHours(hours: number): string {
  const total = Math.max(0, Math.floor(hours))
  return formatDotNetTimeSpan(Math.floor(total / 24), total % 24, 0, 0)
}

export function timeSpanFromDays(days: number): string {
  return formatDotNetTimeSpan(Math.max(0, Math.floor(days)), 0, 0, 0)
}

export function isUnlimitedTimeSpan(raw: string): boolean {
  const parsed = parseDotNetTimeSpan(raw)
  return !raw.trim() || (parsed != null && parsed.totalSeconds === 0)
}

export function describeTimeSpan(raw: string): string {
  if (isUnlimitedTimeSpan(raw)) return 'No limit'
  const parsed = parseDotNetTimeSpan(raw)
  if (!parsed) return raw.trim() || 'Invalid'
  if (parsed.days > 0 && parsed.hours === 0 && parsed.minutes === 0 && parsed.seconds === 0) {
    return `${parsed.days} day${parsed.days === 1 ? '' : 's'}`
  }
  const hours = parsed.days * 24 + parsed.hours
  if (hours > 0 && parsed.minutes === 0 && parsed.seconds === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }
  if (parsed.days === 0 && parsed.hours === 0 && parsed.minutes === 0) {
    return `${parsed.seconds}s`
  }
  if (parsed.days === 0 && parsed.hours === 0 && parsed.seconds === 0) {
    return `${parsed.minutes} min`
  }
  return raw.trim()
}

export function sessionDurationPresetId(raw: string): string {
  if (isUnlimitedTimeSpan(raw)) return 'unlimited'
  const match = SESSION_DURATION_PRESETS.find((preset) => preset.value === raw.trim())
  return match ? match.id : 'custom'
}

export function retentionPresetId(raw: string): string {
  const parsed = parseDotNetTimeSpan(raw)
  if (!parsed || parsed.hours !== 0 || parsed.minutes !== 0 || parsed.seconds !== 0) return 'custom'
  const match = RETENTION_DAY_PRESETS.find((days) => days === parsed.days)
  return match != null ? String(match) : 'custom'
}

export function applyCapacityPreset(current: JsonObject, preset: ResourceCapacityPreset): JsonObject {
  const sessions = { ...asObject(current.sessions), ...preset.sessions }
  const storage = { ...asObject(current.storage), ...preset.storage }
  return { ...current, sessions, storage }
}

export function summarizeResourceManagement(value: JsonObject) {
  const maxSessions = nestedNumber(value, 'sessions', 'maxConcurrentSessions')
  const perProfile = nestedNumber(value, 'sessions', 'maxConcurrentSessionsPerProfile')
  const budgetBytes = nestedNumber(value, 'storage', 'budgetBytes')
  const duration = nestedText(value, 'sessions', 'maxSessionDuration')
  const complete = maxSessions > 0
  return {
    maxSessions,
    perProfile,
    budgetBytes,
    duration,
    complete,
    slotsLabel: complete ? `${maxSessions} slot${maxSessions === 1 ? '' : 's'}` : 'No admission',
    perProfileLabel: perProfile <= 0 ? 'Unlimited / profile' : `${perProfile} / profile`,
    budgetLabel: formatGibLabel(budgetBytes),
    durationLabel: describeTimeSpan(duration),
  }
}
