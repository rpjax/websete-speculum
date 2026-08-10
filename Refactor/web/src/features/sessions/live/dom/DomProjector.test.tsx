import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DomProjector } from './DomProjector'

/**
 * Rule in stone: if the client screen stayed stable for the whole session, any
 * `Resize` is a bug. StartSession measures the surface that stays mounted, so the
 * projector must never issue a corrective resize of its own — only a real box
 * change (ResizeObserver) may resize.
 */

const VIEWPORT_POLICY = {
  minWidth: 320,
  minHeight: 240,
  maxWidth: 4096,
  maxHeight: 2160,
}

let box = { width: 800, height: 600 }
let observerCallbacks: Array<() => void> = []

function renderProjector(startWidth: number, startHeight: number) {
  const requestRemoteResize = vi.fn().mockResolvedValue({ applied: true })
  const view = render(
    <DomProjector
      width={startWidth}
      height={startHeight}
      live
      sessionId="s1"
      token="t1"
      attachPageProjectionDiffSink={() => () => {}}
      onDomInput={() => {}}
      requestRemoteResize={requestRemoteResize}
      viewportPolicy={VIEWPORT_POLICY}
    />,
  )
  return { requestRemoteResize, view }
}

describe('DomProjector viewport sync', () => {
  beforeEach(() => {
    box = { width: 800, height: 600 }
    observerCallbacks = []
    vi.useFakeTimers()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observerCallbacks.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => box.width,
    })
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => box.height,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    // @ts-expect-error — restore jsdom's own zero-size getters.
    delete HTMLDivElement.prototype.clientWidth
    // @ts-expect-error — restore jsdom's own zero-size getters.
    delete HTMLDivElement.prototype.clientHeight
  })

  it('does not resize on mount when the start geometry matches the surface', () => {
    const { requestRemoteResize } = renderProjector(800, 600)

    vi.advanceTimersByTime(2_000)

    expect(requestRemoteResize).not.toHaveBeenCalled()
  })

  it('does not resize on mount even when the start geometry differs from the box', () => {
    // Regression: the projector used to "correct" this drift, which fired a resize
    // into the initial navigation and produced resize_busy. Start owns the initial
    // geometry now — the surface it measured is the one that stays mounted.
    const { requestRemoteResize } = renderProjector(794, 600)

    vi.advanceTimersByTime(2_000)

    expect(requestRemoteResize).not.toHaveBeenCalled()
  })

  it('does not resize when the observer fires with an unchanged box', () => {
    const { requestRemoteResize } = renderProjector(800, 600)

    for (const fire of observerCallbacks) fire()
    vi.advanceTimersByTime(2_000)

    expect(requestRemoteResize).not.toHaveBeenCalled()
  })

  it('still resizes on a real box change', () => {
    const { requestRemoteResize } = renderProjector(800, 600)

    box = { width: 900, height: 640 }
    for (const fire of observerCallbacks) fire()
    vi.advanceTimersByTime(2_000)

    expect(requestRemoteResize).toHaveBeenCalledTimes(1)
    expect(requestRemoteResize.mock.calls[0]?.[0]).toEqual({ width: 900, height: 640 })
  })

  it('mounts layout-only without a session token (pre-Start measure host)', () => {
    const requestRemoteResize = vi.fn().mockResolvedValue({ applied: true })
    render(
      <DomProjector
        width={800}
        height={600}
        live={false}
        sessionId={null}
        token={null}
        attachPageProjectionDiffSink={() => () => {}}
        onDomInput={() => {}}
        requestRemoteResize={requestRemoteResize}
        viewportPolicy={VIEWPORT_POLICY}
      />,
    )
    vi.advanceTimersByTime(2_000)
    expect(requestRemoteResize).not.toHaveBeenCalled()
  })
})
