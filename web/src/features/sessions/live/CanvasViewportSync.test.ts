import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionDeviceProfile } from '@/lib/speculum'
import { SESSION_VIEWPORT_BASELINE as DEFAULT_VIEWPORT_POLICY } from '@/features/sessions/live/sessionViewportPolicy'
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
      viewportPolicy: DEFAULT_VIEWPORT_POLICY,
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
      viewportPolicy: DEFAULT_VIEWPORT_POLICY,
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
      viewportPolicy: DEFAULT_VIEWPORT_POLICY,
      debounceMs: 50,
      detectDevice: () => desktop,
    })
    sync.seedRemote(800, 600, desktop)
    sync.schedule(800, 600)
    await vi.advanceTimersByTimeAsync(50)
    expect(resize).not.toHaveBeenCalled()
    sync.dispose()
  })

  it('skips resize within size epsilon (avoids needless ResizeAsync jitter)', async () => {
    const resize = vi.fn()
    const sync = new CanvasViewportSync({
      measure: () => ({ width: 801, height: 601 }),
      resize,
      viewportPolicy: DEFAULT_VIEWPORT_POLICY,
      debounceMs: 50,
      detectDevice: () => desktop,
    })
    sync.seedRemote(800, 600, desktop)
    sync.schedule(801, 601)
    await vi.advanceTimersByTimeAsync(50)
    expect(resize).not.toHaveBeenCalled()
    sync.dispose()
  })

  it('re-measures at fire time and cancels if layout settled back', async () => {
    const resize = vi.fn()
    let measured = { width: 900, height: 700 }
    const sync = new CanvasViewportSync({
      measure: () => measured,
      resize,
      viewportPolicy: DEFAULT_VIEWPORT_POLICY,
      debounceMs: 50,
      detectDevice: () => desktop,
    })
    sync.seedRemote(800, 600, desktop)
    sync.schedule(900, 700)
    measured = { width: 800, height: 600 }
    await vi.advanceTimersByTimeAsync(50)
    expect(resize).not.toHaveBeenCalled()
    sync.dispose()
  })

  it('retries after applied:false while CSS host still differs from remote', async () => {
    const rejected: string[] = []
    const resize = vi
      .fn()
      .mockResolvedValueOnce({
        applied: false,
        width: 800,
        height: 600,
        errorCode: 'resize_busy',
        message: 'another resize is in progress',
      })
      .mockResolvedValueOnce({
        applied: true,
        width: 1024,
        height: 768,
      })
    const sync = new CanvasViewportSync({
      measure: () => ({ width: 1024, height: 768 }),
      resize,
      viewportPolicy: DEFAULT_VIEWPORT_POLICY,
      debounceMs: 50,
      detectDevice: () => desktop,
      onRejected: (detail) => rejected.push(detail),
    })
    sync.seedRemote(800, 600, desktop)
    sync.schedule(1024, 768)
    await vi.advanceTimersByTimeAsync(50)
    expect(resize).toHaveBeenCalledTimes(1)
    expect(rejected).toEqual(['another resize is in progress'])

    await vi.advanceTimersByTimeAsync(100)
    expect(resize).toHaveBeenCalledTimes(2)
    expect(sync.remoteSize).toEqual({ width: 1024, height: 768 })
    sync.dispose()
  })
})
