import { getApiKey } from '@/lib/auth'
import { API_URL } from '@/lib/env'

export class ApiError extends Error {
  status: number
  body?: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface ConfigStatus {
  operational: boolean
  missing: string[]
}

export interface SnapshotMeta {
  sessionId: string
  lastUrl: string
  byteSize: number
  updatedAt: string
  expiresAt: string
}

export interface ScriptMeta {
  id: string
  name: string
  sha256: string
  size: number
  uploadedAt: string
}

type RequestInitEx = RequestInit & { auth?: boolean }

function formatApiError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      return record.errors.map(String).join('; ')
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

export const api = {
  getStatus: () => request<ConfigStatus>('/api/admin/config/status', { auth: false }),
  getReady: async () => {
    const res = await fetch(`${API_URL}/ready`, { credentials: 'include' })
    return res.ok
  },
  getSection: <T = unknown>(section: string) => request<T>(`/api/admin/config/${section}`),
  putSection: (section: string, body: unknown) =>
    request(`/api/admin/config/${section}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSection: (section: string) =>
    request(`/api/admin/config/${section}`, { method: 'DELETE' }),
  listSnapshots: () => request<SnapshotMeta[]>('/api/admin/snapshots'),
  deleteSnapshot: (sessionId: string) =>
    request(`/api/admin/snapshots/${sessionId}`, { method: 'DELETE' }),
  listScripts: () => request<ScriptMeta[]>('/api/admin/scripts'),
  uploadScript: (file: File, name?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    return request<ScriptMeta>('/api/admin/scripts', { method: 'POST', body: form })
  },
  deleteScript: (id: string) =>
    request(`/api/admin/scripts/${id}`, { method: 'DELETE' }),
  getOpenApi: () => request<unknown>('/openapi/v1.json'),
}
