import { adminJson } from '@/lib/adminFetch'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { telemetryToResourceSamples, type ResourceSample } from '@/lib/resourceChartCompute'

const BASE = '/api/admin/diagnostics/v1'

export type ResourceSectionReadiness = {
  host: boolean
  apiProcess: boolean
  sessions: boolean
  sidecar: boolean
  profiles: boolean
  journal: boolean
  docker: boolean
}

export type ResourceLatestResponse = {
  telemetryEnabled: boolean
  sample: Record<string, unknown> | null
  sections: ResourceSectionReadiness
  collectedAt: string
}

export type ResourceHistoryItem = {
  id: string
  sequence: number
  publishedAt: string
  sample: Record<string, unknown>
}

export type ResourceHistoryResponse = {
  items: ResourceHistoryItem[]
  nextCursor?: string | null
  bucketSeconds?: number | null
}

export type ResourceChartHint = {
  from: string
  to: string
  metricKeys: string[]
}

export type ResourceSignal = {
  id: string
  kind: string
  severity: string
  status: string
  phase: string
  summary: string
  detectedAt: string
  resolvedAt?: string | null
  evidenceSampleIds: string[]
  metrics: Record<string, number | null>
  chartHint?: ResourceChartHint | null
}

export type ResourceReportChapter = {
  title: string
  body: string
  relatedSignalIds?: string[]
  relatedSampleIds?: string[]
  seriesSummary?: Record<string, { min?: number; avg?: number; max?: number; last?: number }>
}

export type ResourceReport = {
  id: string
  kind: string
  status: string
  from: string
  to: string
  createdAt: string
  readyAt?: string | null
  summary: string
  chapters: ResourceReportChapter[]
  error?: { errorCode: string; phase: string } | null
}

export type ListResponse<T> = { items: T[]; total: number }

export function historyToResourceSamples(items: ResourceHistoryItem[]): ResourceSample[] {
  const events: DiagnosticsEventRecord[] = items.map((item) => ({
    diagnosticsSchemaVersion: 2,
    id: item.id,
    utc: item.publishedAt,
    domain: 'Telemetry',
    name: 'Telemetry.Sampling.SampleCollected',
    severity: 'info',
    payload: item.sample,
    redaction: 'none',
  }))
  return telemetryToResourceSamples(events)
}

export const resourceMonitoringApi = {
  latest: () => adminJson<ResourceLatestResponse>(`${BASE}/resources/latest`),
  history: (params: {
    from: string
    to: string
    limit?: number
    bucketSeconds?: number
    cursor?: string
  }) => {
    const q = new URLSearchParams()
    q.set('from', params.from)
    q.set('to', params.to)
    if (params.limit != null) q.set('limit', String(params.limit))
    if (params.bucketSeconds != null) q.set('bucketSeconds', String(params.bucketSeconds))
    if (params.cursor) q.set('cursor', params.cursor)
    return adminJson<ResourceHistoryResponse>(`${BASE}/resources/history?${q}`)
  },
  signals: (params?: { status?: string; kind?: string }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.kind) q.set('kind', params.kind)
    const suffix = q.size ? `?${q}` : ''
    return adminJson<ListResponse<ResourceSignal>>(`${BASE}/signals${suffix}`)
  },
  signal: (id: string) => adminJson<ResourceSignal>(`${BASE}/signals/${id}`),
  reports: (kind?: string) => {
    const suffix = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    return adminJson<ListResponse<ResourceReport>>(`${BASE}/reports${suffix}`)
  },
  report: (id: string) => adminJson<ResourceReport>(`${BASE}/reports/${id}`),
  createReport: (body: { kind: string; from: string; to: string }) =>
    adminJson<ResourceReport>(`${BASE}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
}
