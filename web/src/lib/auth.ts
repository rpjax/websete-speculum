import { MOCK_MODE } from '@/lib/env'
import {
  getApiKey as mockGetApiKey,
  setApiKey as mockSetApiKey,
  clearApiKey as mockClearApiKey,
  isAuthenticated as mockIsAuthenticated,
} from '@/lib/mock/auth.mock'

const KEY = 'speculum_admin_api_key'

function realGetApiKey(): string | null {
  return sessionStorage.getItem(KEY)
}

function realSetApiKey(key: string): void {
  sessionStorage.setItem(KEY, key.trim())
}

function realClearApiKey(): void {
  sessionStorage.removeItem(KEY)
}

function realIsAuthenticated(): boolean {
  return !!realGetApiKey()
}

export const getApiKey = MOCK_MODE ? mockGetApiKey : realGetApiKey
export const setApiKey = MOCK_MODE ? mockSetApiKey : realSetApiKey
export const clearApiKey = MOCK_MODE ? mockClearApiKey : realClearApiKey
export const isAuthenticated = MOCK_MODE ? mockIsAuthenticated : realIsAuthenticated
