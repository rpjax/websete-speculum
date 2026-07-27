import {
  detectDeviceProfile,
  validateResizeViewport,
} from '@/features/motor/live/deviceProfile'
import type { ResizeSessionResult, SessionDeviceProfile } from '@/lib/speculum'

export interface CanvasSize {
  width: number
  height: number
}

export interface CanvasViewportSyncOptions {
  /** Measure the canvas layout box (clientWidth/Height) — not window/screen. */
  measure: () => CanvasSize
  /** Invoke hub ResizeAsync; awaited so only one resize runs at a time. */
  resize: (
    size: CanvasSize,
    device: SessionDeviceProfile,
  ) => Promise<ResizeSessionResult>
  debounceMs?: number
  /** When true, defer remote resize (e.g. IME shell open). */
  isDeferred?: () => boolean
  onApplied?: (size: CanvasSize) => void
  onRejected?: (detail: string) => void
  detectDevice?: () => SessionDeviceProfile
}

function deviceProfilesEqual(
  a: SessionDeviceProfile,
  b: SessionDeviceProfile,
): boolean {
  return (
    a.mobile === b.mobile
    && a.touch === b.touch
    && a.deviceScaleFactor === b.deviceScaleFactor
    && a.maxTouchPoints === b.maxTouchPoints
    && a.userAgentProfile === b.userAgentProfile
    && a.screenOrientation === b.screenOrientation
  )
}

/**
 * CSS layout host → remote session viewport 1:1 sync.
 * Debounces layout noise; single-flight ResizeAsync with pending coalesce.
 * Source of truth is always the host CSS box — never window/screen, never the
 * canvas bitmap attributes (those must not drive layout).
 */
export class CanvasViewportSync {
  private readonly measure: () => CanvasSize
  private readonly resize: CanvasViewportSyncOptions['resize']
  private readonly debounceMs: number
  private readonly isDeferred: () => boolean
  private readonly onApplied?: (size: CanvasSize) => void
  private readonly onRejected?: (detail: string) => void
  private readonly detectDevice: () => SessionDeviceProfile

  private remoteW = 0
  private remoteH = 0
  private deviceProfile: SessionDeviceProfile = detectDeviceProfile()
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private resizeInFlight = false
  private pending = false
  private observer: ResizeObserver | null = null
  private disposed = false

  constructor(options: CanvasViewportSyncOptions) {
    this.measure = options.measure
    this.resize = options.resize
    this.debounceMs = options.debounceMs ?? 250
    this.isDeferred = options.isDeferred ?? (() => false)
    this.onApplied = options.onApplied
    this.onRejected = options.onRejected
    this.detectDevice = options.detectDevice ?? detectDeviceProfile
  }

  /** Last confirmed remote viewport (after applied resize / seed from start). */
  get remoteSize(): CanvasSize {
    return { width: this.remoteW, height: this.remoteH }
  }

  /** Seed confirmed size after StartSession (canvas was already measured for start). */
  seedRemote(width: number, height: number, device?: SessionDeviceProfile): void {
    this.remoteW = width
    this.remoteH = height
    if (device) {
      this.deviceProfile = device
    }
  }

  /** Observe the CSS layout host — never the canvas bitmap element. */
  observe(element: Element): void {
    this.observer?.disconnect()
    this.observer = new ResizeObserver(() => {
      const size = this.measure()
      this.schedule(size.width, size.height)
    })
    this.observer.observe(element)
  }

  /**
   * Debounced remote resize. Coalesces while in flight; flushes latest on complete.
   */
  schedule(rawW: number, rawH: number): void {
    if (this.disposed) {
      return
    }
    if (this.isDeferred()) {
      this.pending = true
      return
    }
    if (this.resizeInFlight) {
      this.pending = true
      return
    }

    const validated = validateResizeViewport(rawW, rawH)
    if (!validated.ok) {
      return
    }
    const { w, h } = validated
    const nextProfile = this.detectDevice()
    if (
      w === this.remoteW
      && h === this.remoteH
      && deviceProfilesEqual(this.deviceProfile, nextProfile)
    ) {
      return
    }

    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
    }
    this.resizeTimer = setTimeout(() => {
      void this.invoke(w, h)
    }, this.debounceMs)
  }

  /** After IME closes (or deferral clears), apply any layout change deferred. */
  flushPending(): void {
    if (!this.pending || this.isDeferred() || this.disposed) {
      return
    }
    this.pending = false
    const size = this.measure()
    this.schedule(size.width, size.height)
  }

  dispose(): void {
    this.disposed = true
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
    this.observer?.disconnect()
    this.observer = null
  }

  private async invoke(w: number, h: number): Promise<void> {
    if (this.disposed || this.resizeInFlight) {
      return
    }
    if (this.isDeferred()) {
      this.pending = true
      return
    }

    const profile = this.detectDevice()
    this.resizeInFlight = true
    try {
      const result = await this.resize({ width: w, height: h }, profile)
      if (this.disposed) {
        return
      }
      if (result.applied) {
        // CSS host was the request source — confirm that size so we do not chase
        // ack/chrome deltas that would re-enter ResizeObserver churn.
        this.remoteW = w
        this.remoteH = h
        this.deviceProfile = profile
        this.onApplied?.({ width: w, height: h })
      } else {
        const detail = result.message || result.errorCode || 'resize rejected'
        this.onRejected?.(String(detail))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.onRejected?.(message)
    } finally {
      this.resizeInFlight = false
      if (this.pending && !this.isDeferred() && !this.disposed) {
        this.pending = false
        const size = this.measure()
        this.schedule(size.width, size.height)
      }
    }
  }
}

/** Read layout host size in CSS pixels (1:1 session viewport target). */
export function measureCanvasElement(el: HTMLElement | null): CanvasSize {
  if (!el) {
    return { width: 0, height: 0 }
  }
  return {
    width: Math.round(el.clientWidth),
    height: Math.round(el.clientHeight),
  }
}
