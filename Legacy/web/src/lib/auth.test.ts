import { describe, it, expect, beforeEach } from 'vitest'
import { getApiKey, setApiKey, clearApiKey, isAuthenticated } from './auth'

describe('auth helpers', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('returns null when no key is stored', () => {
    expect(getApiKey()).toBeNull()
  })

  it('stores and retrieves a key', () => {
    setApiKey('test-api-key-123')
    expect(getApiKey()).toBe('test-api-key-123')
  })

  it('trims whitespace from keys', () => {
    setApiKey('  key-with-spaces  ')
    expect(getApiKey()).toBe('key-with-spaces')
  })

  it('clears the stored key', () => {
    setApiKey('will-be-cleared')
    expect(getApiKey()).not.toBeNull()
    clearApiKey()
    expect(getApiKey()).toBeNull()
  })

  it('isAuthenticated returns false when no key', () => {
    expect(isAuthenticated()).toBe(false)
  })

  it('isAuthenticated returns true after setting key', () => {
    setApiKey('my-key')
    expect(isAuthenticated()).toBe(true)
  })

  it('isAuthenticated returns false after clearing key', () => {
    setApiKey('temp-key')
    clearApiKey()
    expect(isAuthenticated()).toBe(false)
  })
})
