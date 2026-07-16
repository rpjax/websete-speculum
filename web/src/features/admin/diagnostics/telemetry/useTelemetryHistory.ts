import { useCallback, useEffect, useState } from 'react'
import { diagnosticsApi, type TelemetrySampleRecord } from '@/lib/diagnosticsApi'
import {
  telemetryToResourceSamples,
  type ResourceSample,
  type TimePreset,
} from '@/lib/resourceChartCompute'

export interface TelemetryRange {
  preset: TimePreset
  from: number | null
  to: number | null
}

const PRESET_MS: Record<Exclude<TimePreset, 'custom' | 'all'>, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
}

/** Resolve a range into an absolute [since, until] window + its span in ms. */
export function resolveWindow(range: TelemetryRange, now = Date.now()): {
  since?: string
  until?: string
  spanMs: number
} {
  if (range.preset === 'custom') {
    const from = range.from ?? now - PRESET_MS['1h']
    const to = range.to ?? now
    return { since: new Date(from).toISOString(), until: new Date(to).toISOString(), spanMs: to - from }
  }
  if (range.preset === 'all') {
    // Unbounded lower edge — assume up to ~24h of retention for bucket sizing.
    return { spanMs: PRESET_MS['24h'] }
  }
  const ms = PRESET_MS[range.preset]
  return { since: new Date(now - ms).toISOString(), spanMs: ms }
}

/** Chooses a server bucket (seconds) so any range yields a bounded (~500 pt) chart series. */
export function pickBucketSeconds(spanMs: number, target = 500): number {
  const raw = Math.floor(spanMs / 1000 / target)
  if (raw <= 1) return 0 // small range → raw samples, keep full fidelity
  const steps = [30, 60, 120, 300, 600, 1800, 3600]
  return steps.find((s) => s >= raw) ?? 3600
}

interface HistoryState {
  chartSamples: ResourceSample[]
  latest: TelemetrySampleRecord | null
  bucketSeconds: number
  totalRaw: number
  loading: boolean
  error: string | null
}

/**
 * Loads the telemetry chart series for a range. Small ranges fetch raw samples (full fidelity);
 * long ranges use server-side downsampling (last-sample-per-bucket) so payloads stay bounded.
 */
export function useTelemetryHistory(
  range: TelemetryRange,
  opts?: { connectionId?: string; live?: boolean; intervalMs?: number },
) {
  const [state, setState] = useState<HistoryState>({
    chartSamples: [],
    latest: null,
    bucketSeconds: 0,
    totalRaw: 0,
    loading: true,
    error: null,
  })

  const { connectionId } = opts ?? {}

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const { since, until, spanMs } = resolveWindow(range)
      const bucketSeconds = pickBucketSeconds(spanMs)
      const res = await diagnosticsApi.getSampleHistory(
        bucketSeconds > 0
          ? { since, until, connectionId, bucketSeconds }
          : { since, until, connectionId, limit: 2000 },
      )
      const items = res.items as TelemetrySampleRecord[]
      const chartSamples = telemetryToResourceSamples(items)
      setState({
        chartSamples,
        latest: items.length > 0 ? items[items.length - 1] : null,
        bucketSeconds: res.bucketSeconds,
        totalRaw: res.total,
        loading: false,
        error: null,
      })
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load telemetry history',
      }))
    }
  }, [range, connectionId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!opts?.live) return
    const id = setInterval(() => void load(), opts.intervalMs ?? 10_000)
    return () => clearInterval(id)
  }, [opts?.live, opts?.intervalMs, load])

  return { ...state, reload: load }
}
