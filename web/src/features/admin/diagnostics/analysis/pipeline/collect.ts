import { diagnosticsApi } from '@/lib/diagnosticsApi'
import { buildNarrative } from '../../timeline/model/buildNarrative'
import type { AnalysisMandate, EvidenceBag } from '../types'

export async function collectEvidence(mandate: AnalysisMandate): Promise<EvidenceBag> {
  const gaps: string[] = []
  const since = new Date(mandate.fromMs).toISOString()
  const until = new Date(mandate.toMs).toISOString()

  let events = [] as EvidenceBag['events']
  let telemetry = [] as EvidenceBag['telemetry']
  let overview: EvidenceBag['overview'] = null
  let runtime: EvidenceBag['runtime'] = null
  let catalogNames: string[] = []
  const snapshots: EvidenceBag['snapshots'] = []

  if (mandate.includeEvents) {
    try {
      if (mandate.scope.kind === 'sessions') {
        const batches = await Promise.all(
          mandate.scope.connectionIds.map((id) =>
            diagnosticsApi.getSessionEvents(id, since, undefined, until).catch(async () => {
              const all = await diagnosticsApi.getSessionEvents(id, since)
              return all.filter((e) => {
                const t = Date.parse(e.utc)
                return t >= mandate.fromMs && t <= mandate.toMs
              })
            }),
          ),
        )
        events = batches.flat()
      } else if (mandate.scope.kind === 'system') {
        const all = await diagnosticsApi.listEvents({ since, until }).catch(async () => {
          const raw = await diagnosticsApi.listEvents({ since })
          return raw.filter((e) => {
            const t = Date.parse(e.utc)
            return t >= mandate.fromMs && t <= mandate.toMs
          })
        })
        events = all.filter((e) => !e.connectionId || e.domain === 'DiagnosticsSelf')
      } else {
        events = await diagnosticsApi.listEvents({ since, until }).catch(async () => {
          gaps.push('Server until= unavailable — period upper bound filtered on the client.')
          const raw = await diagnosticsApi.listEvents({ since })
          return raw.filter((e) => {
            const t = Date.parse(e.utc)
            return t >= mandate.fromMs && t <= mandate.toMs
          })
        })
      }
    } catch (e: unknown) {
      gaps.push(`Events unavailable: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  } else {
    gaps.push('Event evidence disabled in mandate.')
  }

  if (mandate.includeTelemetry) {
    try {
      const hist = await diagnosticsApi.getSampleHistory({
        since,
        until,
        bucketSeconds: Math.max(30, Math.round((mandate.toMs - mandate.fromMs) / 90_000)),
        limit: 200,
      })
      telemetry = hist.items
      if (telemetry.length === 0) gaps.push('No telemetry samples in the selected period.')
    } catch (e: unknown) {
      gaps.push(`Telemetry unavailable: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  if (mandate.includeRuntime) {
    try {
      overview = await diagnosticsApi.getOverview()
      runtime = await diagnosticsApi.getRuntime()
    } catch (e: unknown) {
      gaps.push(`Runtime/overview unavailable: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  try {
    const catalog = await diagnosticsApi.getEventCatalog()
    catalogNames = Array.isArray(catalog.events)
      ? catalog.events.map((e) => (typeof e === 'string' ? e : (e as { name: string }).name))
      : []
  } catch {
    gaps.push('Event catalog unavailable.')
  }

  if (mandate.includeSnapshots && mandate.depth === 'deep' && mandate.scope.kind === 'sessions') {
    for (const id of mandate.scope.connectionIds) {
      try {
        snapshots.push(await diagnosticsApi.getSession(id))
      } catch {
        gaps.push(`Snapshot unavailable for ${id}.`)
      }
    }
  }

  const narrative = events.length > 0
    ? buildNarrative({
        events,
        scope: mandate.scope.kind === 'sessions' && mandate.scope.connectionIds.length === 1
          ? { kind: 'session', connectionId: mandate.scope.connectionIds[0] }
          : { kind: 'platform' },
        period: { preset: 'custom', fromMs: mandate.fromMs, toMs: mandate.toMs },
      })
    : null

  return {
    mandate,
    events,
    narrative,
    telemetry,
    overview,
    runtime,
    snapshots,
    gaps,
    catalogNames,
  }
}
