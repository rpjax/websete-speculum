export function getApiKey(): string {
  return 'mock-api-key'
}

export function setApiKey(_key: string): void {
  /* no-op in mock mode */
}

export function clearApiKey(): void {
  /* no-op in mock mode */
}

export function isAuthenticated(): boolean {
  return true
}
