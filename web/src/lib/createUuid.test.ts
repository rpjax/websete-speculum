import { describe, expect, it, vi, afterEach } from 'vitest'
import { createCorrelationId, createUuid } from './createUuid'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createUuid', () => {
  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      getRandomValues: (arr: Uint8Array) => arr,
    })
    expect(createUuid()).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(createCorrelationId()).toBe('aaaaaaaabbbbccccddddeeeeeeeeeeee')
  })

  it('falls back when randomUUID is missing (insecure HTTP)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i
        return arr
      },
    })
    const id = createUuid()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(createCorrelationId()).toHaveLength(32)
  })
})
