import { useCallback, useEffect, useState } from 'react'
import { api, ConfigSections, type ConfigStatus } from '@/lib/api'
import {
  diagnosticsApi,
  type DiagnosticsEventRecord,
  type DiagnosticsOverview,
  type MotorSessionListItem,
} from '@/lib/diagnosticsApi'
import { computeHealthScore } from '@/components/admin/HealthScoreGauge'
import { countCapabilities } from '@/lib/diagnosticsConstants'
import { usePolling } from '@/lib/hooks/usePolling'

const POLL_INTERVAL_MS = 15_000

export interface HostingProfile {
  domain: string
  acmeEmail?: string | null
  subdomainMirroringEnabled: boolean
  edgeTls?: { provider: string; email: string; apiToken: string }
}

export interface InjectionEntry {
  scriptId?: string | null
  url?: string | null
  position: string
  type: string
}

export interface MotorOverviewConfig {
  forwarding: { host: string; domains: string[] } | null
  maxSessions: number | null
  sessionPolicy: { ttlDays: number } | null
  jsBridge: { enable: boolean } | null
  hosting: { acmeEmail: string; profiles: HostingProfile[] } | null
  scriptInjection: InjectionEntry[] | null
}

export interface MotorOverview {
  status: ConfigStatus | null
  diagnostics: DiagnosticsOverview | null
  liveSessions: MotorSessionListItem[]
  persistedCount: number
  scriptsCount: number
  recentEvents: DiagnosticsEventRecord[]
  config: MotorOverviewConfig
  healthScore: number
  configuredCount: number
  storagePercent: number
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

async function getSectionSafe<T>(section: string): Promise<T | null> {
  try {
    return await api.getSection<T>(section)
  } catch {
    return null
  }
}

function countConfigured(
  config: MotorOverviewConfig,
  scriptsCount: number,
  diagnostics: DiagnosticsOverview | null,
): number {
  let count = 0
  if (config.forwarding?.host?.trim()) count++
  if ((config.hosting?.profiles.length ?? 0) > 0) count++
  if (config.maxSessions != null) count++
  if (config.sessionPolicy != null) count++
  if (config.jsBridge != null) count++
  if ((config.scriptInjection?.length ?? 0) > 0) count++
  if (scriptsCount > 0) count++
  if (diagnostics?.enabled) count++
  return count
}

function computeScore(
  diagnostics: DiagnosticsOverview | null,
  liveCount: number,
  storagePercent: number,
): number {
  const { off, total } = countCapabilities(diagnostics?.effectiveCapabilities)
  return computeHealthScore({
    degraded: diagnostics?.degraded ?? false,
    eventsDropped: diagnostics?.eventsDropped ?? 0,
    overflowCount: diagnostics?.overflowCount ?? 0,
    liveSessions: liveCount,
    storagePercent,
    capabilitiesOff: off,
    totalCapabilities: total || 1,
  })
}

export function useMotorOverview(): MotorOverview {
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsOverview | null>(null)
  const [liveSessions, setLiveSessions] = useState<MotorSessionListItem[]>([])
  const [persistedCount, setPersistedCount] = useState(0)
  const [scriptsCount, setScriptsCount] = useState(0)
  const [recentEvents, setRecentEvents] = useState<DiagnosticsEventRecord[]>([])
  const [config, setConfig] = useState<MotorOverviewConfig>({
    forwarding: null,
    maxSessions: null,
    sessionPolicy: null,
    jsBridge: null,
    hosting: null,
    scriptInjection: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const since = new Date(Date.now() - 30 * 60_000).toISOString()

      const [
        statusRes,
        diagRes,
        liveRes,
        persistedRes,
        scriptsRes,
        eventsRes,
        forwardingRes,
        maxSessionsRes,
        sessionPolicyRes,
        jsBridgeRes,
        hostingRes,
        scriptInjectionRes,
      ] = await Promise.allSettled([
        api.getStatus(),
        diagnosticsApi.getOverview(),
        diagnosticsApi.listSessions(),
        api.listSessions(),
        api.listScripts(),
        diagnosticsApi.listEvents({ since }),
        getSectionSafe<{ host: string; domains: string[] }>(ConfigSections.Forwarding),
        getSectionSafe<number>(ConfigSections.MaxSessions),
        getSectionSafe<{ ttlDays: number }>(ConfigSections.SessionPolicy),
        getSectionSafe<{ enable: boolean }>(ConfigSections.JsBridge),
        getSectionSafe<{ acmeEmail: string; profiles: HostingProfile[] }>(ConfigSections.Hosting),
        getSectionSafe<InjectionEntry[]>(ConfigSections.ScriptInjection),
      ])

      if (statusRes.status === 'fulfilled') setStatus(statusRes.value)
      else setError('Failed to load system status')

      setDiagnostics(diagRes.status === 'fulfilled' ? diagRes.value : null)
      setLiveSessions(liveRes.status === 'fulfilled' ? liveRes.value.sessions : [])
      setPersistedCount(persistedRes.status === 'fulfilled' ? persistedRes.value.length : 0)
      setScriptsCount(scriptsRes.status === 'fulfilled' ? scriptsRes.value.length : 0)

      if (eventsRes.status === 'fulfilled') {
        setRecentEvents(eventsRes.value.slice(-8).reverse())
      } else {
        setRecentEvents([])
      }

      setConfig({
        forwarding: forwardingRes.status === 'fulfilled' ? forwardingRes.value : null,
        maxSessions: maxSessionsRes.status === 'fulfilled' ? maxSessionsRes.value : null,
        sessionPolicy: sessionPolicyRes.status === 'fulfilled' ? sessionPolicyRes.value : null,
        jsBridge: jsBridgeRes.status === 'fulfilled' ? jsBridgeRes.value : null,
        hosting: hostingRes.status === 'fulfilled' ? hostingRes.value : null,
        scriptInjection: scriptInjectionRes.status === 'fulfilled' ? scriptInjectionRes.value : null,
      })

      setLastUpdated(new Date())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load overview')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  usePolling(load, POLL_INTERVAL_MS, true)

  const storagePercent = diagnostics && diagnostics.storageMaxBytes > 0
    ? (diagnostics.bytesUsed / diagnostics.storageMaxBytes) * 100
    : 0

  const configuredCount = countConfigured(config, scriptsCount, diagnostics)
  const healthScore = computeScore(
    diagnostics,
    diagnostics?.liveSessions.activeCount ?? liveSessions.length,
    storagePercent,
  )

  return {
    status,
    diagnostics,
    liveSessions,
    persistedCount,
    scriptsCount,
    recentEvents,
    config,
    healthScore,
    configuredCount,
    storagePercent,
    loading,
    error,
    lastUpdated,
    refresh: () => { void load() },
  }
}
