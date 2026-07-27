import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionDeviceProfile } from '@/lib/speculum'
import { CanvasViewportSync, measureCanvasElement } from './CanvasViewportSync'

const desktop: SessionDeviceProfile = {
  mobile: false,
  touch: false,
  deviceScaleFactor: 1,
  maxTouchPoints: 0,
}

describe('CanvasViewportSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces and invokes resize with canvas size', async () => {
    const resize = vi.fn(async (size: { width: number; height: number }) => ({
      applied: true,
      width: size.width,
      height: size.height,
    }))
    const sync = new CanvasViewportSync({
      measure: () => ({ width: 800, height: 600 }),
      resize,
      debounceMs: 250,
      detectDevice: () => desktop,
    })
    sync.seedRemote(1280, 720)

    sync.schedule(800, 600)
    expect(resize).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(resize).toHaveBeenCalledTimes(1)
    expect(resize.mock.calls[0]![0]).toEqual({ width: 800, height: 600 })
    sync.dispose()
  })

  it('single-flight: coalesces pending to latest size after in-flight completes', async () => {
    let resolveFirst!: (value: {
      applied: boolean
      width: number
      height: number
    }) => void
    const first = new Promise<{ applied: boolean; width: number; height: number }>((r) => {
      resolveFirst = r
    })
    const resize = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async (size: { width: number; height: number }) => ({
        applied: true,
        width: size.width,
        height: size.height,
      }))

    let measured = { width: 400, height: 300 }
    const sync = new CanvasViewportSync({
      measure: () => measured,
      resize,
      debounceMs: 50,
      detectDevice: () => desktop,
    })
    sync.seedRemote(200, 200)

    sync.schedule(400, 300)
    await vi.advanceTimersByTimeAsync(50)
    expect(resize).toHaveBeenCalledTimes(1)

    measured = { width: 500, height: 400 }
    sync.schedule(500, 400)
    measured = { width: 640, height: 480 }
    sync.schedule(640, 480)
    expect(resize).toHaveBeenCalledTimes(1)

    resolveFirst({ applied: true, width: 400, height: 300 })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(50)
    expect(resize).toHaveBeenCalledTimes(2)
    expect(resize.mock.calls[1]![0]).toEqual({ width: 640, height: 480 })
    sync.dispose()
  })

  it('measureCanvasElement reads element client box, not window', () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'clientWidth', { value: 333 })
    Object.defineProperty(el, 'clientHeight', { value: 222 })
    expect(measureCanvasElement(el)).toEqual({ width: 333, height: 222 })
    expect(measureCanvasElement(null)).toEqual({ width: 0, height: 0 })
  })

  it('skips no-op when size and device unchanged', async () => {
    const resize = vi.fn()
    const sync = new CanvasViewportSync({
      measure: () => ({ width: 800, height: 600 }),
      resize,
      debounceMs: 50,
      detectDevice: () => desktop,
    })
    sync.seedRemote(800, 600, desktop)
    sync.schedule(800, 600)
    await vi.advanceTimersByTimeAsync(50)
    expect(resize).not.toHaveBeenCalled()
    sync.dispose()
  })
})
