const KEY = 'speculum_admin_api_key'

export function getApiKey(): string | null {
  return sessionStorage.getItem(KEY)
}

export function setApiKey(key: string): void {
  sessionStorage.setItem(KEY, key.trim())
}

export function clearApiKey(): void {
  sessionStorage.removeItem(KEY)
}

export function isAuthenticated(): boolean {
  return !!getApiKey()
}
