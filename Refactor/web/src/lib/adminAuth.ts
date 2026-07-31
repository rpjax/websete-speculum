/** Admin auth session — DNA: frontend/wireframe/shell/auth-session.md */

const STORAGE_KEY = 'speculum.admin.auth'

export type AdminAuthTokens = {
  accessToken: string
  accessExpiresAt: string
  refreshToken: string
  refreshExpiresAt: string
  username: string
}

let memory: AdminAuthTokens | null = null

function readStorage(): AdminAuthTokens | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AdminAuthTokens
    if (!parsed?.accessToken || !parsed?.refreshToken) return null
    return parsed
  } catch {
    return null
  }
}

function writeStorage(tokens: AdminAuthTokens | null) {
  if (!tokens) {
    sessionStorage.removeItem(STORAGE_KEY)
    return
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
}

export function getAdminAuth(): AdminAuthTokens | null {
  if (memory) return memory
  memory = readStorage()
  return memory
}

export function setAdminAuth(tokens: AdminAuthTokens) {
  memory = tokens
  writeStorage(tokens)
}

export function clearAdminAuth() {
  memory = null
  writeStorage(null)
}

export function isAdminAuthenticated(): boolean {
  return Boolean(getAdminAuth()?.accessToken)
}

/** Same-origin Admin/Setup paths only. */
export function safeReturnUrl(candidate: string | null | undefined, fallback = '/admin'): string {
  if (!candidate) return fallback
  if (!candidate.startsWith('/')) return fallback
  if (candidate.startsWith('//')) return fallback
  if (!(candidate.startsWith('/admin') || candidate.startsWith('/setup'))) return fallback
  return candidate
}
