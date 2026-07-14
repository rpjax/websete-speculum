import { describe, expect, it } from 'vitest'

/**
 * Intentional stop vs transport disconnect — mirrors MotorEngine.stopSession
 * clearing overlay reconnect UX when the user/app stops deliberately.
 */
export function disconnectStatus(opts: {
  intentionalStop: boolean
}): { status: 'idle' | 'error'; statusText: string; showOverlay: boolean } {
  if (opts.intentionalStop) {
    return { status: 'idle', statusText: '', showOverlay: false }
  }
  return {
    status: 'error',
    statusText: 'Disconnected — click to reconnect',
    showOverlay: true,
  }
}

describe('disconnect intentional-stop', () => {
  it('intentional stop does not show reconnect overlay', () => {
    expect(disconnectStatus({ intentionalStop: true })).toEqual({
      status: 'idle',
      statusText: '',
      showOverlay: false,
    })
  })

  it('transport drop shows reconnect overlay', () => {
    const s = disconnectStatus({ intentionalStop: false })
    expect(s.status).toBe('error')
    expect(s.showOverlay).toBe(true)
    expect(s.statusText).toMatch(/reconnect/i)
  })
})
