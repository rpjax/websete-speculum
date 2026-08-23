import {
  ViewportSync as CoreViewportSync,
  measureHostElement,
  viewportSizesClose,
  VIEWPORT_SIZE_EPSILON,
  type ViewportPolicyBounds,
} from '@speculum/page-projection/projected'
import type { ResizeSessionResult, SessionDeviceProfile } from '@/lib/speculum'
import type { SessionViewportBounds } from '@/features/sessions/live/sessionViewportPolicy'
import { detectDeviceProfile } from '@/features/sessions/live/deviceProfile'

export interface CanvasSize {
  width: number
  height: number
}

export { viewportSizesClose, VIEWPORT_SIZE_EPSILON }

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

/**
 * CSS layout host → remote session viewport 1:1 sync (web video path).
 * Thin wrapper over package {@link CoreViewportSync}.
 */
export class CanvasViewportSync {
  private readonly core: CoreViewportSync

  /** Cap automatic retries after applied:false / throw so permanent faults do not spin. */
  static readonly MAX_REJECT_RETRIES = CoreViewportSync.MAX_REJECT_RETRIES

  constructor(options: CanvasViewportSyncOptions) {
    this.core = new CoreViewportSync({
      measure: options.measure,
      resize: async (size, device) => {
        const result = await options.resize(size, device as SessionDeviceProfile)
        return {
          applied: result.applied,
          width: result.width,
          height: result.height,
          message: result.message ?? undefined,
          errorCode: result.errorCode ?? undefined,
        }
      },
      viewportPolicy: options.viewportPolicy as ViewportPolicyBounds,
      debounceMs: options.debounceMs,
      isDeferred: options.isDeferred,
      onApplied: options.onApplied,
      onRejected: options.onRejected,
      detectDevice: options.detectDevice ?? detectDeviceProfile,
    })
  }

  /** Last confirmed remote viewport (after applied resize / seed from start). */
  get remoteSize(): CanvasSize {
    return this.core.remoteSize
  }

  /** Seed confirmed size after StartSession (canvas was already measured for start). */
  seedRemote(width: number, height: number, device?: SessionDeviceProfile): void {
    this.core.seedRemote(width, height, device ?? undefined)
  }

  /** Observe the CSS layout host — never the canvas bitmap element. */
  observe(element: Element): void {
    this.core.observe(element)
  }

  /** Debounced remote resize — delegates to package core. */
  schedule(rawW: number, rawH: number): void {
    this.core.schedule(rawW, rawH)
  }

  /** After IME closes (or deferral clears), apply any layout change deferred. */
  flushPending(): void {
    this.core.flushPending()
  }

  dispose(): void {
    this.core.dispose()
  }
}

/** Read layout host size in CSS pixels (1:1 session viewport target). */
export function measureCanvasElement(el: HTMLElement | null): CanvasSize {
  return measureHostElement(el)
}
