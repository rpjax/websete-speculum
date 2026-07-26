/** Pure helpers for Motor canvas → remote page coordinate mapping and wheel deltas. */

export function canvasToPageCoords(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  sessionW: number,
  sessionH: number,
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0 || sessionW <= 0 || sessionH <= 0) {
    return { x: 0, y: 0 }
  }
  return {
    x: Math.round((clientX - rect.left) * (sessionW / rect.width)),
    y: Math.round((clientY - rect.top) * (sessionH / rect.height)),
  }
}

export function normalizeWheelDeltas(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  canvasWidth: number,
  canvasHeight: number,
): { deltaX: number; deltaY: number } {
  let dX = deltaX
  let dY = deltaY
  if (deltaMode === 1) {
    dX *= 40
    dY *= 40
  } else if (deltaMode === 2) {
    dX *= canvasWidth
    dY *= canvasHeight
  }
  return { deltaX: dX, deltaY: dY }
}

export function shouldThrottleMove(nowMs: number, lastMoveMs: number, minIntervalMs = 16): boolean {
  return nowMs - lastMoveMs < minIntervalMs
}

export function isLocalBrowserShortcut(key: string, ctrlOrMeta: boolean): boolean {
  if (key === 'F12') return true
  if (ctrlOrMeta && ['r', 'l', 't', 'w', 'n'].includes(key.toLowerCase())) return true
  return false
}

export type TouchPointWire = {
  id: number
  x: number
  y: number
  radiusX?: number
  radiusY?: number
  force?: number
}

export type TouchPhase = 'start' | 'move' | 'end' | 'cancel'

export function buildTouchPayload(
  phase: TouchPhase,
  points: TouchPointWire[],
  changedIds: number[],
): Record<string, unknown> {
  return {
    type: 'touch',
    phase,
    points,
    changedIds,
  }
}
