/** Lab editor for engine config via `/api/configurations/{section}`. */

import {
  createLabTelemetryEventsBaseline,
} from './labTelemetryEvents'

export interface LabDomainLabel {
  match: 'Exact' | 'Any'
  value: string
}

export interface LabDomainPattern {
  scope: 'Any' | 'Pattern'
  labels: LabDomainLabel[]
}

export interface LabUrlMatchRule {
  domain: LabDomainPattern
  path?: { scope: 'Any' | 'Pattern'; segments?: unknown[] }
}

export interface LabHostingDomain {
  domain: string
  isSubdomainMirroringEnabled: boolean
  certificateEmail?: string | null
  dnsChallenge?: unknown
}

export interface LabScreenResolution {
  width: number
  height: number
}

export interface LabInputMultiplexingPolicy {
  access: string
  ownership?: string
  scheduling?: string
}

export interface LabOutputMultiplexingPolicy {
  delivery?: string
  ownership?: string
}

export interface LabSessionsConfig {
  detachedSessionTimeout: string
  isJsBridgeEnabled: boolean
  viewportPolicy: {
    minimum: LabScreenResolution
    default: LabScreenResolution
    maximum: LabScreenResolution
  }
  clientEnvironmentPolicy: {
    defaultLocale: string
    defaultLanguage: string
    defaultTimeZoneId: string
    defaultColorScheme: string
  }
  deviceEmulationPolicy: {
    default: {
      mobile: boolean
      touch: boolean
      deviceScaleFactor: number
      maxTouchPoints: number
      userAgentProfile: string
      screenOrientation: string
    }
    minDeviceScaleFactor: number
    maxDeviceScaleFactor: number
    maxTouchPoints: number
    defaultTouchPointsWhenTouch: number
    desktopUserAgentProfile: string
    mobileUserAgentProfile: string
  }
  inputMultiplexingPolicy: LabInputMultiplexingPolicy
  outputMultiplexingPolicy: LabOutputMultiplexingPolicy
}

export interface LabResourceManagementConfig {
  sessions: {
    maxConcurrentSessions: number
    maxConcurrentSessionsPerProfile?: number
    maxPipesPerSession?: number
    maxSessionDuration?: string
  }
  profiles?: Record<string, unknown>
  diagnostics?: Record<string, unknown>
}

export interface LabTelemetrySectionToggle {
  isEnabled: boolean
}

export interface LabTelemetryHostConfig extends LabTelemetrySectionToggle {
  procPath?: string
  diskPath?: string | null
  sampleIntervalMs?: number
  includeLoadAverage?: boolean
  includeSwap?: boolean
  includeDiskIo?: boolean
  includeNetwork?: boolean
}

export interface LabTelemetryApiProcessConfig extends LabTelemetrySectionToggle {
  sampleIntervalMs?: number
  includePrivateMemory?: boolean
  includeGarbageCollection?: boolean
  includeThreadPool?: boolean
}

export interface LabTelemetrySessionsConfig extends LabTelemetrySectionToggle {
  includeSessionIds?: boolean
  includePerSession?: boolean
  includeUrlHost?: boolean
}

export interface LabTelemetrySidecarConfig extends LabTelemetrySectionToggle {
  includeProcess?: boolean
  includeEventLoop?: boolean
  includeChrome?: boolean
  includeQueues?: boolean
  includeSessionsSummary?: boolean
  includeFaultedIds?: boolean
  timeoutMs?: number
}

export interface LabTelemetryProfilesConfig extends LabTelemetrySectionToggle {
  includeStorageBytes?: boolean
}

export interface LabTelemetryJournalConfig extends LabTelemetrySectionToggle {
  includePressure?: boolean
}

export interface LabTelemetryDockerConfig extends LabTelemetrySectionToggle {
  endpoint?: string
  includeRuntime?: boolean
  includeContainers?: boolean
  timeoutMs?: number
}

/** Engine Telemetry section — sampling and opt-in Telemetry event facts. */
export interface LabTelemetryConfig {
  isEnabled: boolean
  intervalSeconds: number
  events: Record<string, boolean>
  host: LabTelemetryHostConfig
  apiProcess: LabTelemetryApiProcessConfig
  sessions: LabTelemetrySessionsConfig
  sidecar: LabTelemetrySidecarConfig
  profiles: LabTelemetryProfilesConfig
  journal: LabTelemetryJournalConfig
  docker: LabTelemetryDockerConfig
}

export interface LabConfigStatus {
  operational: boolean
  missing: string[]
}

export interface LabEngineConfig {
  hosting: {
    defaultCertificateEmail: string
    domains: LabHostingDomain[]
  }
  navigation: {
    defaultTargetHost: string
    allowedMainFrameUrls: LabUrlMatchRule[]
  }
  sessions: LabSessionsConfig
  resourceManagement: LabResourceManagementConfig
  /** Periodic resource samples → Journal (Telemetry-owned facts). Off unless enabled. */
  telemetry: LabTelemetryConfig
  /** Telemetry-owned event toggles (test/debug). Off unless explicitly enabled. */
  journal?: Record<string, boolean>
  status?: LabConfigStatus
}

export {
  LAB_TELEMETRY_EVENT_TYPES,
  LAB_TELEMETRY_EVENT_GROUPS,
  LAB_TELEMETRY_INPUT_PATH_TYPES,
  createLabTelemetryEventsBaseline,
  emptyLabTelemetryEvents,
  type LabTelemetryEventType,
  type LabTelemetryEventGroup,
  type LabTelemetryEventGroupId,
} from './labTelemetryEvents'

export const CONFIG_STATUS_PATH = '/api/configurations/status'
export const CONFIG_BATCH_PATH = '/api/configurations'
export const CONFIG_HOSTING_PATH = '/api/configurations/Hosting'
export const CONFIG_NAVIGATION_PATH = '/api/configurations/Navigation'
export const CONFIG_SESSIONS_PATH = '/api/configurations/Sessions'
export const CONFIG_RESOURCE_MANAGEMENT_PATH = '/api/configurations/ResourceManagement'
export const CONFIG_TELEMETRY_PATH = '/api/configurations/Telemetry'
export const CONFIG_JOURNAL_PATH = '/api/configurations/Journal'

/** Explicit lab-complete Sessions snapshot (operator-chosen, not product defaults). */
export function createLabSessionsBaseline(): LabSessionsConfig {
  return {
    detachedSessionTimeout: '00:05:00',
    isJsBridgeEnabled: true,
    viewportPolicy: {
      minimum: { width: 100, height: 100 },
      default: { width: 1280, height: 720 },
      maximum: { width: 4096, height: 2160 },
    },
    clientEnvironmentPolicy: {
      defaultLocale: 'en-US',
      defaultLanguage: 'en-US',
      defaultTimeZoneId: 'America/New_York',
      defaultColorScheme: 'dark',
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
    inputMultiplexingPolicy: {
      access: 'Shared',
    },
    outputMultiplexingPolicy: {},
  }
}

export function createLabResourceManagementBaseline(): LabResourceManagementConfig {
  return {
    sessions: {
      maxConcurrentSessions: 10,
      maxConcurrentSessionsPerProfile: 2,
      maxPipesPerSession: 4,
      maxSessionDuration: '08:00:00',
    },
    profiles: {},
    diagnostics: {},
  }
}

/** Human labels for pending-config checklist (API section names → operator language). */
export const LAB_CONFIG_SECTION_LABELS: Record<string, string> = {
  Navigation: 'Where sessions may browse',
  Sessions: 'Viewport, timeouts, and device policy',
  ResourceManagement: 'How many sessions can run',
  Hosting: 'Public session domains',
  Journal: 'Session fact recording',
  Telemetry: 'Sampling + event probes',
}

/** Lab telemetry starts off — opt-in while browsing. */
export function createLabTelemetryBaseline(): LabTelemetryConfig {
  return {
    isEnabled: false,
    intervalSeconds: 15,
    events: createLabTelemetryEventsBaseline(),
    host: {
      isEnabled: true,
      procPath: '/proc',
      sampleIntervalMs: 1000,
      includeLoadAverage: true,
      includeSwap: true,
      includeDiskIo: false,
      includeNetwork: false,
    },
    apiProcess: {
      isEnabled: true,
      sampleIntervalMs: 1000,
      includePrivateMemory: true,
      includeGarbageCollection: true,
      includeThreadPool: true,
    },
    sessions: {
      isEnabled: true,
      includeSessionIds: true,
      includePerSession: false,
      includeUrlHost: true,
    },
    sidecar: {
      isEnabled: true,
      includeProcess: true,
      includeEventLoop: true,
      includeChrome: true,
      includeQueues: true,
      includeSessionsSummary: true,
      includeFaultedIds: true,
      timeoutMs: 2000,
    },
    profiles: {
      isEnabled: true,
      includeStorageBytes: true,
    },
    journal: {
      isEnabled: true,
      includePressure: true,
    },
    docker: {
      isEnabled: false,
      endpoint: 'unix:///var/run/docker.sock',
      includeRuntime: true,
      includeContainers: true,
      timeoutMs: 2000,
    },
  }
}

/**
 * Operator-chosen snapshot that satisfies mandatory completeness for local lab.
 * Does not invent product defaults into the binary — only what this UI applies.
 */
export function createLabReadyNavigation(defaultTargetHost = 'www.google.com'): {
  defaultTargetHost: string
  allowedMainFrameUrls: LabUrlMatchRule[]
} {
  const host = defaultTargetHost.trim() || 'www.google.com'
  return {
    defaultTargetHost: host,
    allowedMainFrameUrls: [{ domain: { scope: 'Any', labels: [] } }],
  }
}

function configBase(hubOrigin: string): string {
  return hubOrigin.trim().replace(/\/$/, '')
}

async function getJson<T>(path: string, hubOrigin: string): Promise<T> {
  const res = await fetch(`${configBase(hubOrigin)}${path}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `GET ${path} failed (${res.status})`)
  }
  return (await res.json()) as T
}

async function putJson(path: string, body: unknown, hubOrigin: string): Promise<void> {
  const res = await fetch(`${configBase(hubOrigin)}${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `PUT ${path} failed (${res.status})`)
  }
}

function normalizeSessions(raw: Partial<LabSessionsConfig> | null | undefined): LabSessionsConfig {
  const baseline = createLabSessionsBaseline()
  if (!raw) {
    return baseline
  }
  return {
    detachedSessionTimeout: raw.detachedSessionTimeout || baseline.detachedSessionTimeout,
    isJsBridgeEnabled: raw.isJsBridgeEnabled ?? baseline.isJsBridgeEnabled,
    viewportPolicy: {
      minimum: {
        width: raw.viewportPolicy?.minimum?.width || 0,
        height: raw.viewportPolicy?.minimum?.height || 0,
      },
      default: {
        width: raw.viewportPolicy?.default?.width || 0,
        height: raw.viewportPolicy?.default?.height || 0,
      },
      maximum: {
        width: raw.viewportPolicy?.maximum?.width || 0,
        height: raw.viewportPolicy?.maximum?.height || 0,
      },
    },
    clientEnvironmentPolicy: {
      defaultLocale: raw.clientEnvironmentPolicy?.defaultLocale ?? '',
      defaultLanguage: raw.clientEnvironmentPolicy?.defaultLanguage ?? '',
      defaultTimeZoneId: raw.clientEnvironmentPolicy?.defaultTimeZoneId ?? '',
      defaultColorScheme: raw.clientEnvironmentPolicy?.defaultColorScheme ?? '',
    },
    deviceEmulationPolicy: {
      default: {
        mobile: raw.deviceEmulationPolicy?.default?.mobile ?? false,
        touch: raw.deviceEmulationPolicy?.default?.touch ?? false,
        deviceScaleFactor: raw.deviceEmulationPolicy?.default?.deviceScaleFactor ?? 0,
        maxTouchPoints: raw.deviceEmulationPolicy?.default?.maxTouchPoints ?? 0,
        userAgentProfile: raw.deviceEmulationPolicy?.default?.userAgentProfile ?? '',
        screenOrientation: raw.deviceEmulationPolicy?.default?.screenOrientation ?? '',
      },
      minDeviceScaleFactor: raw.deviceEmulationPolicy?.minDeviceScaleFactor ?? 0,
      maxDeviceScaleFactor: raw.deviceEmulationPolicy?.maxDeviceScaleFactor ?? 0,
      maxTouchPoints: raw.deviceEmulationPolicy?.maxTouchPoints ?? 0,
      defaultTouchPointsWhenTouch:
        raw.deviceEmulationPolicy?.defaultTouchPointsWhenTouch ?? 0,
      desktopUserAgentProfile: raw.deviceEmulationPolicy?.desktopUserAgentProfile ?? '',
      mobileUserAgentProfile: raw.deviceEmulationPolicy?.mobileUserAgentProfile ?? '',
    },
    inputMultiplexingPolicy: {
      access:
        raw.inputMultiplexingPolicy?.access
        || baseline.inputMultiplexingPolicy.access,
      ownership: raw.inputMultiplexingPolicy?.ownership,
      scheduling: raw.inputMultiplexingPolicy?.scheduling,
    },
    outputMultiplexingPolicy: {
      delivery: raw.outputMultiplexingPolicy?.delivery,
      ownership: raw.outputMultiplexingPolicy?.ownership,
    },
  }
}

function normalizeResourceManagement(
  raw: Partial<LabResourceManagementConfig> | null | undefined,
): LabResourceManagementConfig {
  return {
    sessions: {
      maxConcurrentSessions: raw?.sessions?.maxConcurrentSessions ?? 0,
      maxConcurrentSessionsPerProfile: raw?.sessions?.maxConcurrentSessionsPerProfile,
      maxPipesPerSession: raw?.sessions?.maxPipesPerSession,
      maxSessionDuration: raw?.sessions?.maxSessionDuration,
    },
    profiles: raw?.profiles ?? {},
    diagnostics: raw?.diagnostics ?? {},
  }
}

function normalizeTelemetry(
  raw: Partial<LabTelemetryConfig> | null | undefined,
): LabTelemetryConfig {
  const baseline = createLabTelemetryBaseline()
  if (!raw) {
    return baseline
  }
  return {
    isEnabled: raw.isEnabled ?? baseline.isEnabled,
    intervalSeconds: raw.intervalSeconds ?? baseline.intervalSeconds,
    events: { ...baseline.events, ...raw.events },
    host: { ...baseline.host, ...raw.host },
    apiProcess: { ...baseline.apiProcess, ...raw.apiProcess },
    sessions: { ...baseline.sessions, ...raw.sessions },
    sidecar: { ...baseline.sidecar, ...raw.sidecar },
    profiles: { ...baseline.profiles, ...raw.profiles },
    journal: { ...baseline.journal, ...raw.journal },
    docker: { ...baseline.docker, ...raw.docker },
  }
}

export async function fetchLabEngineConfig(hubOrigin = ''): Promise<LabEngineConfig> {
  const [status, hosting, navigation, sessions, resourceManagement, telemetry] =
    await Promise.all([
      getJson<LabConfigStatus>(CONFIG_STATUS_PATH, hubOrigin),
      getJson<LabEngineConfig['hosting']>(CONFIG_HOSTING_PATH, hubOrigin),
      getJson<LabEngineConfig['navigation']>(CONFIG_NAVIGATION_PATH, hubOrigin),
      getJson<Partial<LabSessionsConfig>>(CONFIG_SESSIONS_PATH, hubOrigin),
      getJson<Partial<LabResourceManagementConfig>>(
        CONFIG_RESOURCE_MANAGEMENT_PATH,
        hubOrigin,
      ),
      getJson<Partial<LabTelemetryConfig>>(CONFIG_TELEMETRY_PATH, hubOrigin),
    ])

  return {
    status,
    hosting: {
      defaultCertificateEmail: hosting.defaultCertificateEmail ?? '',
      domains: hosting.domains ?? [],
    },
    navigation: {
      defaultTargetHost: navigation.defaultTargetHost ?? '',
      allowedMainFrameUrls: navigation.allowedMainFrameUrls ?? [],
    },
    sessions: normalizeSessions(sessions),
    resourceManagement: normalizeResourceManagement(resourceManagement),
    telemetry: normalizeTelemetry(telemetry),
    journal: telemetry.events ?? {},
  }
}

/**
 * Persist Hosting + Navigation + Sessions + ResourceManagement + Telemetry in one
 * validated Apply (no partial mid-save apply).
 */
export async function putLabEngineConfig(
  body: LabEngineConfig,
  hubOrigin = '',
): Promise<LabEngineConfig> {
  await putJson(
    CONFIG_BATCH_PATH,
    {
      Hosting: body.hosting,
      Navigation: body.navigation,
      Sessions: body.sessions,
      ResourceManagement: body.resourceManagement,
      Telemetry: { ...body.telemetry, events: body.journal ?? {} },
    },
    hubOrigin,
  )
  return fetchLabEngineConfig(hubOrigin)
}

function domainKey(rule: LabUrlMatchRule): string {
  if (rule.domain.scope === 'Any') {
    return 'scope:any'
  }
  return (rule.domain.labels ?? [])
    .map((label) => `${label.match}:${label.value}`)
    .join('|')
}

/** Serialize allowlist editor lines → Navigation.AllowedMainFrameUrls. */
export function parseAllowlistLines(
  text: string,
  allowAny: boolean,
  previous: LabUrlMatchRule[] = [],
): LabUrlMatchRule[] {
  if (allowAny) {
    const priorAny = previous.find((rule) => rule.domain.scope === 'Any')
    return [
      {
        domain: { scope: 'Any', labels: [] },
        path: priorAny?.path,
      },
    ]
  }

  const previousByKey = new Map(previous.map((rule) => [domainKey(rule), rule]))
  const rules: LabUrlMatchRule[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase()
    if (!line || line.startsWith('#')) {
      continue
    }
    if (line.startsWith('*.')) {
      const apex = line.slice(2)
      const labels = apex.split('.').filter(Boolean)
      if (labels.length === 0) {
        continue
      }
      const rule: LabUrlMatchRule = {
        domain: {
          scope: 'Pattern',
          labels: [
            { match: 'Any', value: '' },
            ...labels.map((value) => ({ match: 'Exact' as const, value })),
          ],
        },
      }
      const prior = previousByKey.get(domainKey(rule))
      if (prior?.path) {
        rule.path = prior.path
      }
      rules.push(rule)
      continue
    }

    const labels = line.split('.').filter(Boolean)
    if (labels.length === 0) {
      continue
    }
    const rule: LabUrlMatchRule = {
      domain: {
        scope: 'Pattern',
        labels: labels.map((value) => ({ match: 'Exact' as const, value })),
      },
    }
    const prior = previousByKey.get(domainKey(rule))
    if (prior?.path) {
      rule.path = prior.path
    }
    rules.push(rule)
  }
  return rules
}

export function formatAllowlistLines(rules: LabUrlMatchRule[]): {
  allowAny: boolean
  text: string
} {
  if (rules.some((rule) => rule.domain.scope === 'Any')) {
    return { allowAny: true, text: '' }
  }

  const lines: string[] = []
  for (const rule of rules) {
    const labels = rule.domain.labels ?? []
    if (labels.length === 0) {
      continue
    }
    if (labels[0]?.match === 'Any') {
      const apex = labels
        .slice(1)
        .map((label) => label.value)
        .filter(Boolean)
        .join('.')
      if (apex) {
        lines.push(`*.${apex}`)
      }
      continue
    }
    lines.push(labels.map((label) => label.value).filter(Boolean).join('.'))
  }
  return { allowAny: false, text: lines.join('\n') }
}

export function parseHostingDomainLines(
  text: string,
  previous: LabHostingDomain[] = [],
): LabHostingDomain[] {
  const previousByDomain = new Map(
    previous.map((domain) => [domain.domain.trim().toLowerCase(), domain]),
  )
  const domains: LabHostingDomain[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase()
    if (!line || line.startsWith('#')) {
      continue
    }
    const mirroring = line.endsWith(' mirroring') || line.endsWith(' +mirror')
    const domain = line
      .replace(/\s+\+?mirroring$/i, '')
      .replace(/\s+\+mirror$/i, '')
      .trim()
    if (!domain) {
      continue
    }
    const prior = previousByDomain.get(domain)
    domains.push({
      domain,
      isSubdomainMirroringEnabled: mirroring,
      certificateEmail: prior?.certificateEmail,
      dnsChallenge: prior?.dnsChallenge,
    })
  }
  return domains
}

export function formatHostingDomainLines(domains: LabHostingDomain[]): string {
  return domains
    .map((domain) =>
      domain.isSubdomainMirroringEnabled ? `${domain.domain} +mirror` : domain.domain,
    )
    .join('\n')
}
