const KEY = 'speculum_session_id'

export function loadSessionId(): string | null {
  return localStorage.getItem(KEY)
}

export function saveSessionId(id: string): void {
  localStorage.setItem(KEY, id)
}
