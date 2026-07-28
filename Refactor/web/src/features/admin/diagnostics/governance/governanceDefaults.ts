import { DIAGNOSTICS_PRESETS } from '@/lib/diagnosticsConstants'
import type { DiagnosticsOptions, DiagnosticsProfile } from '@/lib/diagnosticsApi'

export const DEFAULT_CONFIG: DiagnosticsOptions = {
  enabled: true,
  profile: 'Production',
  domains: DIAGNOSTICS_PRESETS.Production.domains,
  telemetry: DIAGNOSTICS_PRESETS.Production.telemetry,
  storage: DIAGNOSTICS_PRESETS.Production.storage,
  sampling: DIAGNOSTICS_PRESETS.Production.sampling,
  elevate: { browserQueryMaxMinutes: 30 },
  probe: {
    diagTimeoutMs: 10_000,
    maxConcurrentProbesPerSession: 2,
    maxProbeResponseBytes: 512 * 1024,
  },
}

/** Config toggle-group → effective-capability domain (wire enum key). */
export const DOMAIN_GROUPS = [
  { group: 'motor', effectiveKey: 'MotorLive' },
  { group: 'sidecar', effectiveKey: 'SidecarBrowser' },
  { group: 'browserQuery', effectiveKey: 'BrowserQuery' },
  { group: 'persisted', effectiveKey: 'PersistedSessions' },
] as const

export type ConfigDomainGroup = (typeof DOMAIN_GROUPS)[number]['group']

export const PROFILES: DiagnosticsProfile[] = ['Development', 'Production', 'Assertive']

/** Operator-facing copy for each seed profile (mirrors DiagnosticsSeedProfiles intent). */
export const PROFILE_GUIDES: Record<
  DiagnosticsProfile,
  {
    tagline: string
    audience: string
    highlights: string[]
  }
> = {
  Development: {
    tagline: 'Full local visibility',
    audience: 'Local debugging and feature work',
    highlights: [
      'Probes + sidecar events on',
      'Identity-rich telemetry',
      'Sample every 15s',
      '16 GB · 30d retention',
    ],
  },
  Production: {
    tagline: 'Operable evidence, controlled cost',
    audience: 'Live traffic — diagnose without slowing the motor',
    highlights: [
      'Sessions + sidecar events on; probes via Elevate',
      'Telemetry IDs + URL host on; per-session rows off',
      'Fault / profile / Journal pressure signals on',
      '16 GB · 30d · half status-mirror sampling',
    ],
  },
  Assertive: {
    tagline: 'Maximum evidence for CI',
    audience: 'MotorAssert / automated verification',
    highlights: [
      'All probes and events on',
      'Identity opt-ins on',
      'Sample every 10s',
      '32 GB · 90d retention',
    ],
  },
}

export const OVERFLOW_POLICIES = ['DropOldest'] as const

export function mergeDiagnosticsConfig(section: Partial<DiagnosticsOptions> | null | undefined): DiagnosticsOptions {
  return {
    ...DEFAULT_CONFIG,
    ...section,
    domains: {
      ...DEFAULT_CONFIG.domains,
      ...section?.domains,
      motor: { ...DEFAULT_CONFIG.domains.motor, ...section?.domains?.motor },
      sidecar: { ...DEFAULT_CONFIG.domains.sidecar, ...section?.domains?.sidecar },
      browserQuery: { ...DEFAULT_CONFIG.domains.browserQuery, ...section?.domains?.browserQuery },
      persisted: { ...DEFAULT_CONFIG.domains.persisted, ...section?.domains?.persisted },
    },
    telemetry: {
      ...DEFAULT_CONFIG.telemetry,
      ...section?.telemetry,
      host: { ...DEFAULT_CONFIG.telemetry.host, ...section?.telemetry?.host },
      apiProcess: { ...DEFAULT_CONFIG.telemetry.apiProcess, ...section?.telemetry?.apiProcess },
      sessions: { ...DEFAULT_CONFIG.telemetry.sessions, ...section?.telemetry?.sessions },
      sidecar: { ...DEFAULT_CONFIG.telemetry.sidecar, ...section?.telemetry?.sidecar },
      profiles: { ...DEFAULT_CONFIG.telemetry.profiles, ...section?.telemetry?.profiles },
      journal: { ...DEFAULT_CONFIG.telemetry.journal, ...section?.telemetry?.journal },
      docker: { ...DEFAULT_CONFIG.telemetry.docker, ...section?.telemetry?.docker },
    },
    storage: { ...DEFAULT_CONFIG.storage, ...section?.storage },
    sampling: { ...DEFAULT_CONFIG.sampling, ...section?.sampling },
    elevate: { ...DEFAULT_CONFIG.elevate, ...section?.elevate },
    probe: { ...DEFAULT_CONFIG.probe, ...section?.probe },
  }
}
