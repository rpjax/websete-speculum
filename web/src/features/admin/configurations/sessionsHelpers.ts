/** Helpers for Sessions configuration facilitated fields (.NET TimeSpan, presets, summaries). */

import {
  describeTimeSpan,
  parseDotNetTimeSpan,
} from './resourceManagementHelpers'
import { SESSION_VIEWPORT_BASELINE } from '@/features/sessions/live/sessionViewportPolicy'

export type JsonObject = Record<string, unknown>

export const text = (value: unknown) =>
  typeof value === 'string' ? value : value == null ? '' : String(value)

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Wire baseline matching engine-safe empty fill (validator completeness). */
export const DATA_STREAM_TRANSPORT_OPTIONS: Array<[string, string, string]> = [
  [
    'webTransport',
    'WebTransport',
    'HTTP/3 data plane (/w7s/vtransport). Requires UDP to the API in production.',
  ],
  [
    'webSocket',
    'WebSocket',
    'Muxed data plane (/w7s/vstream). Same-origin proxyable like the control hub.',
  ],
]

/** Admin-only Sessions.MirrorMode — Launch-scoped; projected to client-config (client does not choose). */
export const MIRROR_MODE_OPTIONS: Array<[string, string, string]> = [
  [
    'videoStreaming',
    'Video streaming',
    'JPEG screencast frames and coordinate input.',
  ],
  [
    'pageProjection',
    'DOM projection',
    'Projected PageProjection frames and element input.',
  ],
]

export const SESSIONS_BASELINE: JsonObject = {
  detachedSessionTimeout: '00:30:00',
  isJsBridgeEnabled: true,
  dataStreamTransport: 'webTransport',
  mirrorMode: 'pageProjection',
  frameQueueCapacity: 8192,
  viewportPolicy: {
    minimum: {
      width: SESSION_VIEWPORT_BASELINE.minWidth,
      height: SESSION_VIEWPORT_BASELINE.minHeight,
    },
    default: {
      width: SESSION_VIEWPORT_BASELINE.defaultWidth,
      height: SESSION_VIEWPORT_BASELINE.defaultHeight,
    },
    maximum: {
      width: SESSION_VIEWPORT_BASELINE.maxWidth,
      height: SESSION_VIEWPORT_BASELINE.maxHeight,
    },
  },
  clientEnvironmentPolicy: {
    defaultLocale: 'pt-BR',
    defaultLanguage: 'pt-BR',
    defaultTimeZoneId: 'America/Sao_Paulo',
    defaultColorScheme: 'light',
  },
  deviceEmulationPolicy: {
    default: {
      mobile: false,
      touch: false,
      deviceScaleFactor: 1,
      maxTouchPoints: 0,
      userAgentProfile: 'desktop',
      screenOrientation: 'landscapePrimary',
    },
    minDeviceScaleFactor: 1,
    maxDeviceScaleFactor: 2,
    maxTouchPoints: 10,
    defaultTouchPointsWhenTouch: 5,
    desktopUserAgentProfile: 'desktop',
    mobileUserAgentProfile: 'mobile',
  },
  screencastPolicy: {
    maxEncodeScale: 2,
  },
  inputMultiplexingPolicy: {
    access: 'shared',
    ownership: 'firstAttached',
    scheduling: 'arrivalOrder',
  },
  outputMultiplexingPolicy: {
    delivery: 'broadcast',
    ownership: 'firstAttached',
  },
}

export const DETACHED_TIMEOUT_PRESETS = [
  { id: '3s', label: '3 seconds', value: '00:00:03' },
  { id: '5m', label: '5 minutes', value: '00:05:00' },
  { id: '15m', label: '15 minutes', value: '00:15:00' },
  { id: '30m', label: '30 minutes', value: '00:30:00' },
  { id: '1h', label: '1 hour', value: '01:00:00' },
] as const

export const VIEWPORT_SIZE_PRESETS = [
  { id: '720p', label: '1280×720', width: 1280, height: 720 },
  { id: '1080p', label: '1920×1080', width: 1920, height: 1080 },
  { id: 'wxga', label: '1366×768', width: 1366, height: 768 },
  { id: 'wxga+', label: '1440×900', width: 1440, height: 900 },
  { id: 'qhd', label: '2560×1440', width: 2560, height: 1440 },
] as const

export const CLIENT_ENV_PRESETS = [
  {
    id: 'en-utc-light',
    label: 'en-US · UTC · Light',
    defaultLocale: 'en-US',
    defaultLanguage: 'en-US',
    defaultTimeZoneId: 'UTC',
    defaultColorScheme: 'light',
  },
  {
    id: 'en-utc-dark',
    label: 'en-US · UTC · Dark',
    defaultLocale: 'en-US',
    defaultLanguage: 'en-US',
    defaultTimeZoneId: 'UTC',
    defaultColorScheme: 'dark',
  },
  {
    id: 'pt-br',
    label: 'pt-BR · São Paulo · Light',
    defaultLocale: 'pt-BR',
    defaultLanguage: 'pt-BR',
    defaultTimeZoneId: 'America/Sao_Paulo',
    defaultColorScheme: 'light',
  },
  {
    id: 'no-pref',
    label: 'en-US · UTC · No preference',
    defaultLocale: 'en-US',
    defaultLanguage: 'en-US',
    defaultTimeZoneId: 'UTC',
    defaultColorScheme: 'no-preference',
  },
] as const

export const COLOR_SCHEME_OPTIONS: Array<[string, string]> = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['no-preference', 'No preference'],
]

export const INPUT_ACCESS_OPTIONS: Array<[string, string, string]> = [
  ['shared', 'Shared', 'Any attached client may send input.'],
  ['exclusive', 'Exclusive', 'Only the owning client may send input.'],
]

export const INPUT_OWNERSHIP_OPTIONS: Array<[string, string, string]> = [
  ['firstAttached', 'First attached', 'Owner is the first pipe that attaches.'],
  ['firstClaim', 'First claim', 'Owner is the first client that claims control.'],
  ['preemptiveClaim', 'Preemptive claim', 'A new claim can take ownership immediately.'],
]

export const INPUT_SCHEDULING_OPTIONS: Array<[string, string, string]> = [
  ['arrivalOrder', 'Arrival order', 'Process input in the order events arrive.'],
  ['roundRobin', 'Round robin', 'Fair-share input across attached clients.'],
]

export const OUTPUT_DELIVERY_OPTIONS: Array<[string, string, string]> = [
  [
    'broadcast',
    'Broadcast',
    'All attached pipes receive frames (required for multi-pipe live sessions).',
  ],
  [
    'exclusive',
    'Exclusive',
    'Only the owning pipe receives frames — can starve attach/frame pipes.',
  ],
]

export const OUTPUT_OWNERSHIP_OPTIONS: Array<[string, string, string]> = [
  ['firstAttached', 'First attached', 'Owner is the first pipe that attaches.'],
  ['firstClaim', 'First claim', 'Owner is the first client that claims output.'],
  ['preemptiveClaim', 'Preemptive claim', 'A new claim can take output ownership.'],
]

/** Operator-facing screencast sharpness — maps to ScreencastPolicy.MaxEncodeScale. */
export const SCREEENCAST_SHARPNESS_PRESETS = [
  {
    id: 'sharp',
    scale: 2,
    label: 'Sharp',
    blurb: 'Retina-ready. Uses up to 2× pixels when the client screen is HiDPI. Costs more CPU and bandwidth.',
  },
  {
    id: 'lean',
    scale: 1,
    label: 'Lean',
    blurb: 'One pixel per CSS pixel. Soft on Retina, lighter on CPU and network. Prefer on busy hosts.',
  },
] as const

export function screencastSharpnessId(maxEncodeScale: unknown): 'sharp' | 'lean' | 'custom' {
  const n = asNumber(maxEncodeScale, 2)
  if (n === 2) return 'sharp'
  if (n === 1) return 'lean'
  return 'custom'
}

export function validateScreencastScale(value: JsonObject): string | undefined {
  const n = asNumber(asObject(value.screencastPolicy).maxEncodeScale, NaN)
  if (!Number.isFinite(n) || n < 1 || n > 2) {
    return 'Stream sharpness must be Sharp (2) or Lean (1).'
  }
  return undefined
}

export type SessionsGuidedPresetId = 'lab' | 'shared' | 'locked-down'

export type SessionsGuidedPreset = {
  id: SessionsGuidedPresetId
  label: string
  /** When to pick this posture (operator intent). */
  description: string
  /** What the merge changes in plain language. */
  effect: string
  detachedSessionTimeout: string
  isJsBridgeEnabled: boolean
  viewportPolicy: JsonObject
  clientEnvironmentPolicy: JsonObject
  deviceEmulationPolicy: JsonObject
  inputMultiplexingPolicy: JsonObject
  outputMultiplexingPolicy: JsonObject
  screencastPolicy: JsonObject
}

const desktopDevice = asObject(SESSIONS_BASELINE.deviceEmulationPolicy)

export const SESSIONS_GUIDED_PRESETS: SessionsGuidedPreset[] = [
  {
    id: 'lab',
    label: 'Lab',
    description: 'You are trying things locally and want a short, scriptable session.',
    effect: '15 min hold · JS bridge on · 720p · Sharp stream · shared input · broadcast frames.',
    detachedSessionTimeout: '00:15:00',
    isJsBridgeEnabled: true,
    viewportPolicy: {
      minimum: { width: 100, height: 100 },
      default: { width: 1280, height: 720 },
      maximum: { width: 4096, height: 2160 },
    },
    clientEnvironmentPolicy: asObject(SESSIONS_BASELINE.clientEnvironmentPolicy),
    deviceEmulationPolicy: desktopDevice,
    inputMultiplexingPolicy: {
      access: 'shared',
      ownership: 'firstAttached',
      scheduling: 'arrivalOrder',
    },
    outputMultiplexingPolicy: {
      delivery: 'broadcast',
      ownership: 'firstAttached',
    },
    screencastPolicy: { maxEncodeScale: 2 },
  },
  {
    id: 'shared',
    label: 'Shared viewing',
    description: 'Several people may attach and watch or drive the same live session.',
    effect: '30 min hold · bridge on · 1080p · Sharp stream · shared input · broadcast frames.',
    detachedSessionTimeout: '00:30:00',
    isJsBridgeEnabled: true,
    viewportPolicy: {
      minimum: { width: 100, height: 100 },
      default: { width: 1920, height: 1080 },
      maximum: { width: 4096, height: 2160 },
    },
    clientEnvironmentPolicy: asObject(SESSIONS_BASELINE.clientEnvironmentPolicy),
    deviceEmulationPolicy: desktopDevice,
    inputMultiplexingPolicy: {
      access: 'shared',
      ownership: 'firstAttached',
      scheduling: 'arrivalOrder',
    },
    outputMultiplexingPolicy: {
      delivery: 'broadcast',
      ownership: 'firstAttached',
    },
    screencastPolicy: { maxEncodeScale: 2 },
  },
  {
    id: 'locked-down',
    label: 'Locked-down',
    description: 'One operator should control the session; pages must not get a scripting bridge.',
    effect: '15 min hold · bridge off · Lean stream · exclusive input · broadcast frames kept on.',
    detachedSessionTimeout: '00:15:00',
    isJsBridgeEnabled: false,
    viewportPolicy: {
      minimum: { width: 100, height: 100 },
      default: { width: 1280, height: 720 },
      maximum: { width: 2560, height: 1440 },
    },
    clientEnvironmentPolicy: {
      defaultLocale: 'en-US',
      defaultLanguage: 'en-US',
      defaultTimeZoneId: 'UTC',
      defaultColorScheme: 'no-preference',
    },
    deviceEmulationPolicy: desktopDevice,
    inputMultiplexingPolicy: {
      access: 'exclusive',
      ownership: 'firstClaim',
      scheduling: 'arrivalOrder',
    },
    outputMultiplexingPolicy: {
      delivery: 'broadcast',
      ownership: 'firstAttached',
    },
    screencastPolicy: { maxEncodeScale: 1 },
  },
]

/** Extra posture card — fill missing nests without overwriting operator values. */
export const SESSIONS_FILL_GAPS_POSTURE = {
  id: 'fill-gaps' as const,
  label: 'Keep my values',
  description: 'You already edited fields and only need missing defaults filled in.',
  effect: 'Adds baseline viewport, environment, or device settings only where they are absent.',
}

export const DEVICE_EMULATION_PRESETS = [
  {
    id: 'desktop',
    label: 'Desktop',
    description: 'Mouse/keyboard, scale 1, landscape desktop UA.',
    patch: {
      default: {
        mobile: false,
        touch: false,
        deviceScaleFactor: 1,
        maxTouchPoints: 0,
        userAgentProfile: 'desktop',
        screenOrientation: 'landscapePrimary',
      },
      minDeviceScaleFactor: 1,
      maxDeviceScaleFactor: 2,
      maxTouchPoints: 10,
      defaultTouchPointsWhenTouch: 5,
      desktopUserAgentProfile: 'desktop',
      mobileUserAgentProfile: 'mobile',
    },
  },
  {
    id: 'mobile',
    label: 'Mobile touch',
    description: 'Touch + mobile UA, scale 2, portrait.',
    patch: {
      default: {
        mobile: true,
        touch: true,
        deviceScaleFactor: 2,
        maxTouchPoints: 5,
        userAgentProfile: 'mobile',
        screenOrientation: 'portraitPrimary',
      },
      minDeviceScaleFactor: 1,
      maxDeviceScaleFactor: 3,
      maxTouchPoints: 10,
      defaultTouchPointsWhenTouch: 5,
      desktopUserAgentProfile: 'desktop',
      mobileUserAgentProfile: 'mobile',
    },
  },
] as const

export function detachedTimeoutPresetId(raw: string): string {
  const match = DETACHED_TIMEOUT_PRESETS.find((preset) => preset.value === raw.trim())
  return match ? match.id : 'custom'
}

export function viewportSizePresetId(width: number, height: number): string {
  const match = VIEWPORT_SIZE_PRESETS.find(
    (preset) => preset.width === width && preset.height === height,
  )
  return match ? match.id : 'custom'
}

export function mergeObject(current: JsonObject, patch: JsonObject): JsonObject {
  return { ...current, ...patch }
}

export function mergeViewport(current: JsonObject, patch: JsonObject): JsonObject {
  return {
    ...current,
    minimum: { ...asObject(current.minimum), ...asObject(patch.minimum) },
    default: { ...asObject(current.default), ...asObject(patch.default) },
    maximum: { ...asObject(current.maximum), ...asObject(patch.maximum) },
  }
}

export function mergeDeviceEmulation(current: JsonObject, patch: JsonObject): JsonObject {
  return {
    ...current,
    ...patch,
    default: { ...asObject(current.default), ...asObject(patch.default) },
  }
}

/** Guided Lab / Shared / Locked-down — merges nests without dropping unrelated keys. */
export function applySessionsGuidedPreset(
  current: JsonObject,
  preset: SessionsGuidedPreset,
): JsonObject {
  return {
    ...current,
    detachedSessionTimeout: preset.detachedSessionTimeout,
    isJsBridgeEnabled: preset.isJsBridgeEnabled,
    viewportPolicy: mergeViewport(asObject(current.viewportPolicy), preset.viewportPolicy),
    clientEnvironmentPolicy: mergeObject(
      asObject(current.clientEnvironmentPolicy),
      preset.clientEnvironmentPolicy,
    ),
    deviceEmulationPolicy: mergeDeviceEmulation(
      asObject(current.deviceEmulationPolicy),
      preset.deviceEmulationPolicy,
    ),
    inputMultiplexingPolicy: mergeObject(
      asObject(current.inputMultiplexingPolicy),
      preset.inputMultiplexingPolicy,
    ),
    outputMultiplexingPolicy: mergeObject(
      asObject(current.outputMultiplexingPolicy),
      preset.outputMultiplexingPolicy,
    ),
    screencastPolicy: mergeObject(
      asObject(current.screencastPolicy),
      preset.screencastPolicy,
    ),
  }
}

/** Fill only missing top-level nests from baseline (safe empty-section bootstrap). */
export function fillSessionsGaps(current: JsonObject): JsonObject {
  return {
    ...SESSIONS_BASELINE,
    ...current,
    detachedSessionTimeout:
      text(current.detachedSessionTimeout) || text(SESSIONS_BASELINE.detachedSessionTimeout),
    isJsBridgeEnabled:
      typeof current.isJsBridgeEnabled === 'boolean'
        ? current.isJsBridgeEnabled
        : Boolean(SESSIONS_BASELINE.isJsBridgeEnabled),
    dataStreamTransport:
      text(current.dataStreamTransport) === 'webSocket' ? 'webSocket' : 'webTransport',
    mirrorMode:
      text(current.mirrorMode) === 'videoStreaming' ? 'videoStreaming' : 'pageProjection',
    viewportPolicy: current.viewportPolicy ?? SESSIONS_BASELINE.viewportPolicy,
    clientEnvironmentPolicy:
      current.clientEnvironmentPolicy ?? SESSIONS_BASELINE.clientEnvironmentPolicy,
    deviceEmulationPolicy: current.deviceEmulationPolicy ?? SESSIONS_BASELINE.deviceEmulationPolicy,
    screencastPolicy: current.screencastPolicy ?? SESSIONS_BASELINE.screencastPolicy,
    inputMultiplexingPolicy:
      current.inputMultiplexingPolicy ?? SESSIONS_BASELINE.inputMultiplexingPolicy,
    outputMultiplexingPolicy:
      current.outputMultiplexingPolicy ?? SESSIONS_BASELINE.outputMultiplexingPolicy,
  }
}

export function validateDetachedTimeout(raw: string): string | undefined {
  const parsed = parseDotNetTimeSpan(raw)
  if (!parsed) return 'Use a .NET TimeSpan such as 00:30:00 or 1.00:00:00.'
  if (parsed.totalSeconds <= 0) return 'Detached timeout must be greater than zero.'
  return undefined
}

export function validateViewportOrdering(value: JsonObject): string | undefined {
  const viewport = asObject(value.viewportPolicy)
  const minimum = asObject(viewport.minimum)
  const defaults = asObject(viewport.default)
  const maximum = asObject(viewport.maximum)
  const minW = asNumber(minimum.width)
  const minH = asNumber(minimum.height)
  const defW = asNumber(defaults.width)
  const defH = asNumber(defaults.height)
  const maxW = asNumber(maximum.width)
  const maxH = asNumber(maximum.height)
  if (![minW, minH, defW, defH, maxW, maxH].every((n) => n > 0)) {
    return 'Viewport minimum, default, and maximum must all be positive.'
  }
  if (minW > defW || minH > defH || defW > maxW || defH > maxH) {
    return 'Viewport must satisfy 0 < Minimum ≤ Default ≤ Maximum.'
  }
  return undefined
}

export function validateClientEnvironment(value: JsonObject): string | undefined {
  const env = asObject(value.clientEnvironmentPolicy)
  if (
    !text(env.defaultLocale).trim() ||
    !text(env.defaultLanguage).trim() ||
    !text(env.defaultTimeZoneId).trim()
  ) {
    return 'Locale, language, and time zone are required.'
  }
  const scheme = text(env.defaultColorScheme).toLowerCase()
  if (!COLOR_SCHEME_OPTIONS.some(([id]) => id === scheme)) {
    return 'Color scheme must be light, dark, or no-preference.'
  }
  return undefined
}

export function describeEnumLabel(
  options: Array<[string, string] | [string, string, string]>,
  value: string,
): string {
  const match = options.find(([id]) => id === value)
  return match ? match[1] : value || '—'
}

export function summarizeSessions(value: JsonObject) {
  const timeout = text(value.detachedSessionTimeout)
  const parsed = parseDotNetTimeSpan(timeout)
  const jsBridge = Boolean(value.isJsBridgeEnabled)
  const dataStreamTransport =
    text(value.dataStreamTransport) === 'webSocket' ? 'webSocket' : 'webTransport'
  const mirrorMode =
    text(value.mirrorMode) === 'videoStreaming' ? 'videoStreaming' : 'pageProjection'
  const viewport = asObject(asObject(value.viewportPolicy).default)
  const width = asNumber(viewport.width)
  const height = asNumber(viewport.height)
  const hasViewport = width > 0 && height > 0
  const client = asObject(value.clientEnvironmentPolicy)
  const deviceDefault = asObject(asObject(value.deviceEmulationPolicy).default)
  const hasClient = Boolean(text(client.defaultLocale).trim())
  const hasDevice = Boolean(text(deviceDefault.userAgentProfile).trim())
  const input = asObject(value.inputMultiplexingPolicy)
  const output = asObject(value.outputMultiplexingPolicy)
  const access = text(input.access || 'shared')
  const delivery = text(output.delivery || 'broadcast')
  const maxEncodeScale = asNumber(asObject(value.screencastPolicy).maxEncodeScale, 2)
  const sharpnessId = screencastSharpnessId(maxEncodeScale)
  const sharpnessLabel =
    sharpnessId === 'sharp' ? 'Sharp' : sharpnessId === 'lean' ? 'Lean' : `Scale ${maxEncodeScale}`
  const timeoutOk = parsed != null && parsed.totalSeconds > 0
  const complete = timeoutOk && hasViewport && hasClient && hasDevice

  return {
    timeout,
    timeoutLabel: timeoutOk ? describeTimeSpan(timeout) : timeout.trim() ? 'Invalid' : 'Not set',
    timeoutOk,
    jsBridge,
    jsBridgeLabel: jsBridge ? 'JS bridge on' : 'JS bridge off',
    dataStreamTransport,
    dataStreamTransportLabel: describeEnumLabel(
      DATA_STREAM_TRANSPORT_OPTIONS,
      dataStreamTransport,
    ),
    mirrorMode,
    mirrorModeLabel: describeEnumLabel(MIRROR_MODE_OPTIONS, mirrorMode),
    viewportWidth: width,
    viewportHeight: height,
    viewportLabel: hasViewport ? `${width}×${height}` : 'Not set',
    hasViewport,
    access,
    delivery,
    multiplexingLabel: `${describeEnumLabel(INPUT_ACCESS_OPTIONS, access)} · ${describeEnumLabel(OUTPUT_DELIVERY_OPTIONS, delivery)}`,
    maxEncodeScale,
    sharpnessId,
    sharpnessLabel,
    hasClient,
    hasDevice,
    complete,
    deviceMobile: Boolean(deviceDefault.mobile),
  }
}

export { describeTimeSpan, parseDotNetTimeSpan }
