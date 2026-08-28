import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitConfigApplied } from './waitConfigApplied'

vi.mock('@/lib/diagnosticsApi', () => ({
  diagnosticsApi: {
    listEvents: vi.fn(),
  },
}))

import { diagnosticsApi } from '@/lib/diagnosticsApi'

describe('waitConfigApplied', () => {
  afterEach(() => {
    vi.mocked(diagnosticsApi.listEvents).mockReset()
    vi.useRealTimers()
  })

  it('returns true when a ConfigApplied event appears', async () => {
    const since = new Date().toISOString()
    vi.mocked(diagnosticsApi.listEvents).mockResolvedValueOnce([
      {
        diagnosticsSchemaVersion: 2,
        id: '1',
        utc: since,
        domain: 'DiagnosticsSelf',
        name: 'Diagnostics.ConfigApplied',
        severity: 'Info',
        payload: {},
        redaction: 'none',
      },
    ])

    await expect(waitConfigApplied(since, 1_000)).resolves.toBe(true)
    expect(diagnosticsApi.listEvents).toHaveBeenCalledWith({
      since,
      namePrefix: 'Diagnostics.ConfigApplied',
    })
  })

  it('returns false on timeout when no event arrives', async () => {
    vi.mocked(diagnosticsApi.listEvents).mockResolvedValue([])
    await expect(waitConfigApplied(new Date().toISOString(), 600)).resolves.toBe(false)
  })
})
