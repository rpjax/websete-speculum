import { getApiKey } from '@/lib/auth'
import { API_URL, MOCK_MODE } from '@/lib/env'
import { ApiError } from '@/lib/errors'
import { mockApi } from '@/lib/mock/api.mock'

export { ApiError }

export interface ConfigStatus {
  operational: boolean
  missing: string[]
  hosting?: {
    profiles: Array<{
      domain: string
      subdomainMirroringEnabled: boolean
      mirroringOperational: boolean
      missing: string[]
    }>
  }
}

export interface SessionMeta {
  sessionId: string
  clientToken: string
  updatedAt: string
  expiresAt: string
  cookieCount: number
  localStorageCount: number
  idbRecordCount: number
  historyCount: number
}

export interface SessionDetail {
  sessionId: string
  clientToken: string
  cookies: Array<{ name: string; domain: string; path: string; value: string }>
  localStorage: Array<{ origin: string; key: string; value: string }>
  idbRecords: Array<{ origin: string; databaseName: string; storeName: string; keyJson: string }>
  history: Array<{ url: string; title: string; indexOrder: number }>
}

export interface ScriptMeta {
  id: string
  name: string
  sha256: string
  size: number
  uploadedAt: string
  updatedAt?: string
}

export interface ScriptListResponse {
  items: ScriptMeta[]
  total: number
}

export interface HostResourceProvisionParams {
  maxRamBytes?: number | null
  reservePercent?: number
  reserveMinBytes?: number
  shmMinBytes?: number
  shmMaxPercentOfBudget?: number
  raiseUlimits?: boolean
  nofile?: number
  nproc?: number
}

export interface HostResourceProvisionPlan {
  hostMemoryTotalBytes: number
  hostCpuCount: number
  hostSource: string
  budgetBytes: number
  reserveBytes: number
  shmTargetBytes: number
  raiseUlimits: boolean
  nofile: number
  nproc: number
  params: HostResourceProvisionParams
}

export interface HostResourceApplyResult {
  plan: HostResourceProvisionPlan
  shmBeforeBytes: number
  shmAppliedBytes: number
  ulimitsRaised: boolean
  nofileApplied?: number | null
  nprocApplied?: number | null
  warnings: string[]
  appliedAtUtc: string
}

export interface HostResourceStatus {
  host?: {
    memoryTotalBytes: number
    memoryAvailableBytes: number
    cpuCount: number
    source: string
  } | null
  sidecar?: {
    shmSizeBytes?: number | null
    nofile?: number | null
    nproc?: number | null
    error?: string | null
  } | null
  lastApply?: {
    params: HostResourceProvisionParams
    budgetBytes: number
    reserveBytes: number
    shmTargetBytes: number
    shmAppliedBytes: number
    hostMemoryTotalBytes: number
    hostCpuCount: number
    hostSource: string
    ulimitsRaised: boolean
    warnings: string[]
    appliedAtUtc: string
  } | null
  hostError?: string | null
}

export interface ScriptTargetRule {
  domain: {
    scope: 'Any' | 'Pattern'
    labels: Array<{ match: 'Exact' | 'Any'; value: string }>
  }
  path: {
    scope: 'Any' | 'Pattern'
    matchType: 'Exact' | 'Prefix'
    segments: Array<{ match: 'Exact' | 'Any'; value: string }>
  }
}

export interface ScriptingInjectionEntry {
  source: {
    sourceType: 'Stored' | 'Remote'
    storedScriptId?: string | null
    remoteUrl?: string | null
  }
  position: 'HeadStart' | 'HeadEnd' | 'BodyStart' | 'BodyEnd'
  executionType: 'Classic' | 'Module'
  targetRules: ScriptTargetRule[]
}

export interface ScriptingConfiguration {
  injections: ScriptingInjectionEntry[]
}

type RequestInitEx = RequestInit & { auth?: boolean }

function formatApiError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      return record.errors.map(String).join('; ')
    }
    if (record.errors && typeof record.errors === 'object' && !Array.isArray(record.errors)) {
      const parts = Object.entries(record.errors as Record<string, unknown>)
        .flatMap(([key, value]) => {
          if (Array.isArray(value)) return value.map((item) => `${key}: ${String(item)}`)
          if (value != null) return [`${key}: ${String(value)}`]
          return []
        })
      if (parts.length > 0) return parts.join('; ')
    }
    if (typeof record.title === 'string' && typeof record.detail === 'string') {
      return `${record.title}: ${record.detail}`
    }
    if (typeof record.error === 'string') return record.error
  }
  return `Request failed: ${status}`
}

async function request<T>(path: string, init: RequestInitEx = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  if (init.auth !== false) {
    const key = getApiKey()
    if (key) headers.set('Authorization', `Bearer ${key}`)
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    let body: unknown
    try { body = await res.json() } catch { /* ignore */ }
    throw new ApiError(formatApiError(res.status, body), res.status, body)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  return text ? JSON.parse(text) as T : (undefined as T)
}

export const ConfigSections = {
  Admin: 'Admin',
  Forwarding: 'Forwarding',
  MaxSessions: 'MaxSessions',
  ScriptInjection: 'ScriptInjection',
  SessionPolicy: 'SessionPolicy',
  JsBridge: 'JsBridge',
  Hosting: 'Hosting',
  Diagnostics: 'Diagnostics',
  Telemetry: 'Telemetry',
  Scripting: 'Scripting',
} as const

export type ConfigSectionName = (typeof ConfigSections)[keyof typeof ConfigSections]

const realApi = {
  getStatus: () => request<ConfigStatus>('/api/admin/config/status', { auth: false }),
  getReady: async () => {
    const res = await fetch(`${API_URL}/ready`, { credentials: 'include' })
    return res.ok
  },
  getSection: <T = unknown>(section: ConfigSectionName | string) =>
    request<T>(`/api/admin/config/${section}`),
  putSection: (section: ConfigSectionName | string, body: unknown) =>
    request(`/api/admin/config/${section}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSection: (section: ConfigSectionName | string) =>
    request(`/api/admin/config/${section}`, { method: 'DELETE' }),
  get: <T = unknown>(path: string) => request<T>(path),
  delete: (path: string) => request(path, { method: 'DELETE' }),
  listSessions: () => request<SessionMeta[]>('/api/admin/sessions'),
  getSession: (sessionId: string) => request<SessionDetail>(`/api/admin/sessions/${sessionId}`),
  deleteSession: (sessionId: string) =>
    request(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' }),
  listScripts: (query = '', skip = 0, take = 50) => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('query', query.trim())
    if (skip > 0) params.set('skip', String(skip))
    if (take > 0) params.set('take', String(take))
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return request<ScriptListResponse>(`/api/scripts${suffix}`)
  },
  uploadScript: (file: File, name?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    return request<ScriptMeta>('/api/scripts', { method: 'POST', body: form })
  },
  deleteScript: (id: string) =>
    request(`/api/scripts/${id}`, { method: 'DELETE' }),
  getScripting: () => request<ScriptingConfiguration>('/api/configurations/Scripting'),
  putScripting: (body: ScriptingConfiguration) =>
    request('/api/configurations/Scripting', { method: 'PUT', body: JSON.stringify(body) }),
  clearScripting: () =>
    request('/api/configurations/Scripting', {
      method: 'PUT',
      body: JSON.stringify({ injections: [] }),
    }),
  getOpenApi: () => request<unknown>('/openapi/v1.json'),

  getHostResources: () =>
    request<HostResourceStatus>('/api/admin/host-resources'),
  previewHostResources: (body: HostResourceProvisionParams) =>
    request<HostResourceProvisionPlan>('/api/admin/host-resources/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  applyHostResources: (body: HostResourceProvisionParams) =>
    request<HostResourceApplyResult>('/api/admin/host-resources/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export const api: typeof realApi = MOCK_MODE ? mockApi : realApi
