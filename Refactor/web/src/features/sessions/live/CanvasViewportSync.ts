import {
  validateResizeViewport,
  type SessionViewportBounds,
} from '@/features/sessions/live/sessionViewportPolicy'
import { detectDeviceProfile } from '@/features/sessions/live/deviceProfile'
import type { ResizeSessionResult, SessionDeviceProfile } from '@/lib/speculum'

export interface CanvasSize {
  width: number
  height: number
}

/** Ignore sub-pixel / scrollbar jitter — avoid needless ResizeAsync chatter. */
export const VIEWPORT_SIZE_EPSILON = 2

export interface CanvasViewportSyncOptions {
  /** Measure the CSS layout host (clientWidth/Height) — not window/screen/bitmap. */
  measure: () => CanvasSize
  /** Invoke hub ResizeAsync; awaited so only one resize runs at a time. */
  resize: (
    size: CanvasSize,
    device: SessionDeviceProfile,
  ) => Promise<ResizeSessionResult>
  /** Sessions.ViewportPolicy from client-config — required (no hardcoded product max). */
  viewportPolicy: SessionViewportBounds
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

export function viewportSizesClose(
  aW: number,
  aH: number,
  bW: number,
  bH: number,
  epsilon = VIEWPORT_SIZE_EPSILON,
): boolean {
  return Math.abs(aW - bW) <= epsilon && Math.abs(aH - bH) <= epsilon
}

/**
 * CSS layout host → remote session viewport 1:1 sync.
 * Debounces layout noise; single-flight ResizeAsync with pending coalesce.
 * Source of truth is always the host CSS box — never window/screen, never the
 * canvas bitmap attributes (those must not drive layout).
 * On reject/error, retries with backoff while the CSS box still differs from remote
 * (ResizeObserver will not re-fire on a stable host).
 */
export class CanvasViewportSync {
  private readonly measure: () => CanvasSize
  private readonly resize: CanvasViewportSyncOptions['resize']
  private readonly viewportPolicy: SessionViewportBounds
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
  private consecutiveRejects = 0
  private observer: ResizeObserver | null = null
  private disposed = false

  /** Cap automatic retries after applied:false / throw so permanent faults do not spin. */
  static readonly MAX_REJECT_RETRIES = 5

  constructor(options: CanvasViewportSyncOptions) {
    this.measure = options.measure
    this.resize = options.resize
    this.viewportPolicy = options.viewportPolicy
    this.debounceMs = options.debounceMs ?? 320
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
    this.consecutiveRejects = 0
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
   * No-ops when within {@link VIEWPORT_SIZE_EPSILON} of the confirmed remote size.
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

    const validated = validateResizeViewport(rawW, rawH, this.viewportPolicy)
    if (!validated.ok) {
      return
    }
    const { w, h } = validated
    const nextProfile = this.detectDevice()
    if (
      viewportSizesClose(w, h, this.remoteW, this.remoteH)
      && deviceProfilesEqual(this.deviceProfile, nextProfile)
    ) {
      return
    }

    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
    }
    const delay = this.rejectBackoffMs()
    this.resizeTimer = setTimeout(() => {
      void this.invoke()
    }, delay)
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

  private rejectBackoffMs(): number {
    if (this.consecutiveRejects <= 0) {
      return this.debounceMs
    }
    // 1→2×, 2→4×… capped so transient resize_busy / apply_failed can recover.
    const factor = Math.min(8, 2 ** Math.min(this.consecutiveRejects, 3))
    return Math.min(2_000, this.debounceMs * factor)
  }

  private async invoke(): Promise<void> {
    if (this.disposed || this.resizeInFlight) {
      return
    }
    if (this.isDeferred()) {
      this.pending = true
      return
    }

    // Re-measure at fire time — layout may have settled back to seed size.
    const latest = this.measure()
    const validated = validateResizeViewport(latest.width, latest.height, this.viewportPolicy)
    if (!validated.ok) {
      return
    }
    const targetW = validated.w
    const targetH = validated.h
    const profile = this.detectDevice()
    if (
      viewportSizesClose(targetW, targetH, this.remoteW, this.remoteH)
      && deviceProfilesEqual(this.deviceProfile, profile)
    ) {
      this.consecutiveRejects = 0
      return
    }

    this.resizeInFlight = true
    try {
      const result = await this.resize({ width: targetW, height: targetH }, profile)
      if (this.disposed) {
        return
      }
      if (result.applied) {
        // Confirm the CSS-requested size — never chase ack/chrome deltas.
        this.remoteW = targetW
        this.remoteH = targetH
        this.deviceProfile = profile
        this.consecutiveRejects = 0
        this.onApplied?.({ width: targetW, height: targetH })
      } else {
        const detail = result.message || result.errorCode || 'resize rejected'
        this.onRejected?.(String(detail))
        this.consecutiveRejects++
        if (this.consecutiveRejects <= CanvasViewportSync.MAX_REJECT_RETRIES) {
          this.pending = true
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.onRejected?.(message)
      this.consecutiveRejects++
      if (this.consecutiveRejects <= CanvasViewportSync.MAX_REJECT_RETRIES) {
        this.pending = true
      }
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
