import { describe, expect, it } from 'vitest'
import {
  buildTouchPayload,
  canvasToPageCoords,
  isLocalBrowserShortcut,
  normalizeWheelDeltas,
  shouldThrottleMove,
} from './motorInputCoords'

describe('motorInputCoords', () => {
  it('canvasToPageCoords maps CSS pixels to session viewport', () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 }
    expect(canvasToPageCoords(150, 100, rect, 1280, 720)).toEqual({ x: 320, y: 360 })
  })

  it('canvasToPageCoords returns zeros for degenerate rect', () => {
    expect(canvasToPageCoords(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 1280, 720))
      .toEqual({ x: 0, y: 0 })
  })

  it('normalizeWheelDeltas scales line and page modes', () => {
    expect(normalizeWheelDeltas(1, 2, 1, 800, 600)).toEqual({ deltaX: 40, deltaY: 80 })
    expect(normalizeWheelDeltas(0.5, 1, 2, 800, 600)).toEqual({ deltaX: 400, deltaY: 600 })
    expect(normalizeWheelDeltas(3, 4, 0, 800, 600)).toEqual({ deltaX: 3, deltaY: 4 })
  })

  it('shouldThrottleMove respects 16ms budget', () => {
    expect(shouldThrottleMove(100, 90)).toBe(true)
    expect(shouldThrottleMove(100, 80)).toBe(false)
  })

  it('isLocalBrowserShortcut blocks F12 and ctrl shortcuts', () => {
    expect(isLocalBrowserShortcut('F12', false)).toBe(true)
    expect(isLocalBrowserShortcut('r', true)).toBe(true)
    expect(isLocalBrowserShortcut('a', false)).toBe(false)
  })

  it('buildTouchPayload preserves phase, points and changedIds', () => {
    const payload = buildTouchPayload(
      'start',
      [{ id: 1, x: 10, y: 20, force: 0.5 }],
      [1],
    )
    expect(payload).toEqual({
      type: 'touch',
      phase: 'start',
      points: [{ id: 1, x: 10, y: 20, force: 0.5 }],
      changedIds: [1],
    })
  })
})
