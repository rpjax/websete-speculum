import { API_URL } from '@/lib/env'
import {
  clearAdminAuth,
  getAdminAuth,
  setAdminAuth,
  safeReturnUrl,
  type AdminAuthTokens,
} from '@/lib/adminAuth'

export class AdminApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
    this.body = body
  }
}

type RefreshResponse = {
  accessToken: string
  accessExpiresAt: string
  refreshToken: string
  refreshExpiresAt: string
}

let refreshInFlight: Promise<boolean> | null = null

async function postRefresh(refreshToken: string): Promise<AdminAuthTokens | null> {
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as RefreshResponse
  const prev = getAdminAuth()
  const next: AdminAuthTokens = {
    accessToken: data.accessToken,
    accessExpiresAt: data.accessExpiresAt,
    refreshToken: data.refreshToken,
    refreshExpiresAt: data.refreshExpiresAt,
    username: prev?.username ?? '',
  }
  setAdminAuth(next)
  return next
}

function ensureRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const auth = getAdminAuth()
    if (!auth?.refreshToken) return false
    const next = await postRefresh(auth.refreshToken)
    return Boolean(next)
  })().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

function hardExpire() {
  const path = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/admin'
  const returnUrl = encodeURIComponent(safeReturnUrl(path))
  clearAdminAuth()
  if (typeof window !== 'undefined') {
    const onExpired = window.location.pathname.startsWith('/admin/session-expired')
    const onLogin = window.location.pathname.startsWith('/admin/login')
    if (!onExpired && !onLogin) {
      window.location.assign(`/admin/session-expired?returnUrl=${returnUrl}`)
    }
  }
}

export type AdminFetchOptions = RequestInit & {
  /** Skip Bearer (login/refresh/public). */
  public?: boolean
  /** Skip single refresh retry. */
  skipRefresh?: boolean
}

export async function adminFetch(path: string, init: AdminFetchOptions = {}): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')

  if (!init.public) {
    const auth = getAdminAuth()
    if (auth?.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
  }

  const res = await fetch(url, { ...init, headers })
  if (res.status !== 401 || init.public || init.skipRefresh) return res

  const ok = await ensureRefresh()
  if (!ok) {
    hardExpire()
    return res
  }

  const retryHeaders = new Headers(init.headers)
  if (!retryHeaders.has('Accept')) retryHeaders.set('Accept', 'application/json')
  const auth = getAdminAuth()
  if (auth?.accessToken) retryHeaders.set('Authorization', `Bearer ${auth.accessToken}`)
  const { public: _p, skipRefresh: _s, ...retryInit } = init
  const retry = await fetch(url, { ...retryInit, headers: retryHeaders })
  if (retry.status === 401) hardExpire()
  return retry
}

export async function adminJson<T>(path: string, init: AdminFetchOptions = {}): Promise<T> {
  const res = await adminFetch(path, init)
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`
    throw new AdminApiError(msg, res.status, body)
  }
  return body as T
}

export async function adminLogin(username: string, password: string): Promise<AdminAuthTokens> {
  const data = await adminJson<RefreshResponse>('/api/auth/login', {
    method: 'POST',
    public: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const tokens: AdminAuthTokens = {
    ...data,
    username,
  }
  setAdminAuth(tokens)
  return tokens
}

export async function adminChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  await adminJson<{ ok: boolean }>('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  clearAdminAuth()
}
