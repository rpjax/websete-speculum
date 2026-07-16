import { useCallback, useRef, useState } from 'react'
import {
  diagnosticsApi,
  type DiagnosticsEventRecord,
  type DiagnosticsOverview,
  type DiagnosticsRuntimeSnapshot,
  type HostTelemetry,
  type TelemetrySampleRecord,
} from '@/lib/diagnosticsApi'
import { telemetryToResourceSamples, type ResourceSample } from '@/lib/resourceChartCompute'
import {
  composeTelemetryAnalysis,
  type AnalysisCoverage,
  type AnalysisWindow,
  type TelemetryAnalysisReport,
} from '@/lib/telemetryAnalysis'
import { pickBucketSeconds } from '../monitor/useTelemetryMonitorSeries'

export type AnalysisRangePreset = '1h' | '6h' | '24h' | 'custom'

export interface AnalysisRange {
  preset: AnalysisRangePreset
  from: number | null
  to: number | null
}

const PRESET_MS: Record<Exclude<AnalysisRangePreset, 'custom'>, number> = {
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
}

export function resolveAnalysisWindow(range: AnalysisRange, now = Date.now()): AnalysisWindow {
  if (range.preset === 'custom') {
    const from = range.from ?? now - PRESET_MS['1h']
    const to = range.to ?? now
    return { since: new Date(from).toISOString(), until: new Date(to).toISOString(), spanMs: Math.max(0, to - from) }
  }
  const ms = PRESET_MS[range.preset]
  return { since: new Date(now - ms).toISOString(), until: new Date(now).toISOString(), spanMs: ms }
}

export interface ConsumeProgress {
  phase: 'idle' | 'samples' | 'events' | 'context' | 'compose' | 'done' | 'cancelled' | 'error'
  loaded: number
  total: number
  message: string
}

/**
 * Independent Analysis ingest — never reads Monitor state.
 * Paginates telemetry history, pulls events + runtime/overview/host, then composes the report.
 */
export function useTelemetryAnalysisConsume(maxSamples = 20_000) {
  const [progress, setProgress] = useState<ConsumeProgress>({
    phase: 'idle', loaded: 0, total: 0, message: 'Choose a window and run analysis.',
  })
  const [report, setReport] = useState<TelemetryAnalysisReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef(false)

  const cancel = useCallback(() => {
    cancelRef.current = true
    setProgress((p) => ({ ...p, phase: 'cancelled', message: 'Analysis cancelled.' }))
  }, [])

  const run = useCallback(async (range: AnalysisRange) => {
    cancelRef.current = false
    setError(null)
    setReport(null)
    const window = resolveAnalysisWindow(range)
    const dataSources: string[] = []

    try {
      setProgress({ phase: 'samples', loaded: 0, total: 0, message: 'Reading telemetry samples…' })

      // Probe total with a tiny page
      const probe = await diagnosticsApi.getSampleHistory({
        since: window.since,
        until: window.until,
        limit: 1,
      })
      if (cancelRef.current) return

      const total = probe.total
      let samples: ResourceSample[] = []
      let truncated = false
      let bucketed = false

      if (total > maxSamples) {
        const bucketSeconds = Math.max(pickBucketSeconds(window.spanMs, 800), 30)
        setProgress({
          phase: 'samples',
          loaded: 0,
          total,
          message: `Window has ${total.toLocaleString()} samples — using substrate (bucket ${bucketSeconds}s)…`,
        })
        const res = await diagnosticsApi.getSampleHistory({
          since: window.since,
          until: window.until,
          bucketSeconds,
        })
        samples = telemetryToResourceSamples(res.items as TelemetrySampleRecord[])
        truncated = true
        bucketed = true
        dataSources.push('telemetry.history(bucketed)')
      } else {
        dataSources.push('telemetry.history')
        let cursor: string | null = null
        let loaded = 0
        const records: TelemetrySampleRecord[] = []
        do {
          if (cancelRef.current) return
          const page = await diagnosticsApi.getSampleHistory({
            since: window.since,
            until: window.until,
            limit: 500,
            cursor,
          })
          records.push(...(page.items as TelemetrySampleRecord[]))
          loaded = records.length
          cursor = page.nextCursor
          setProgress({
            phase: 'samples',
            loaded,
            total: page.total || total,
            message: `Analyzing samples… ${loaded.toLocaleString()} / ${(page.total || total).toLocaleString()}`,
          })
        } while (cursor)
        samples = telemetryToResourceSamples(records)
      }

      if (cancelRef.current) return

      setProgress({ phase: 'events', loaded: samples.length, total: samples.length, message: 'Reading diagnostics events…' })
      let events: DiagnosticsEventRecord[] = []
      try {
        events = await diagnosticsApi.listEvents({ since: window.since, until: window.until })
        events = events.filter((e) => e.name !== 'Telemetry.SampleCollected')
        dataSources.push('events')
      } catch {
        /* events optional */
      }

      if (cancelRef.current) return

      setProgress({ phase: 'context', loaded: samples.length, total: samples.length, message: 'Reading runtime context…' })
      let runtime: DiagnosticsRuntimeSnapshot | null = null
      let overview: DiagnosticsOverview | null = null
      let host: HostTelemetry | null = null
      try {
        runtime = await diagnosticsApi.getRuntime()
        dataSources.push('runtime')
      } catch { /* optional */ }
      try {
        overview = await diagnosticsApi.getOverview()
        dataSources.push('overview')
      } catch { /* optional */ }
      try {
        host = await diagnosticsApi.getHost()
        dataSources.push('host')
      } catch { /* optional */ }

      if (cancelRef.current) return

      setProgress({ phase: 'compose', loaded: samples.length, total: samples.length, message: 'Composing didactic report…' })
      const coverage: AnalysisCoverage = {
        samples: samples.length,
        bucketed,
        truncated,
        events: events.length,
        dataSources,
      }
      const next = composeTelemetryAnalysis({
        samples,
        events,
        runtime,
        overview,
        host,
        window,
        coverage,
      })
      setReport(next)
      setProgress({
        phase: 'done',
        loaded: samples.length,
        total: samples.length,
        message: `Report ready — ${next.chapters.length} chapters, score ${next.executive.healthScore}.`,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Analysis failed'
      setError(msg)
      setProgress({ phase: 'error', loaded: 0, total: 0, message: msg })
    }
  }, [maxSamples])

  return { progress, report, error, run, cancel }
}
