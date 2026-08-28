/**
 * Host CSS box → remote Virtual viewport lockstep (lab + prod).
 * Debounce, single-flight, reject backoff, optional visualViewport/DPR listeners.
 * Source of truth for "applied" size is the last confirmed remote ack — not optimistic.
 */

import {
  measureHostElement,
  validateResizeViewport,
  viewportSizesClose,
  type ViewportPolicyBounds,
  type ViewportSize,
} from './viewportPolicy';
import {
  detectViewportDeviceProfile,
  deviceProfilesEqual,
  type ViewportDeviceProfile,
} from './viewportDevice';

export type ViewportResizeResult = {
  applied: boolean;
  width?: number;
  height?: number;
  message?: string;
  errorCode?: string;
};

export type ViewportSyncOptions = {
  /** Measure the CSS layout host (clientWidth/Height) — not window/screen. */
  measure: () => ViewportSize;
  /** Invoke remote resize; awaited so only one runs at a time. */
  resize: (
    size: ViewportSize,
    device: ViewportDeviceProfile,
  ) => Promise<ViewportResizeResult>;
  viewportPolicy: ViewportPolicyBounds;
  debounceMs?: number;
  /** When true, defer remote resize (e.g. IME shell open). */
  isDeferred?: () => boolean;
  onApplied?: (size: ViewportSize, device: ViewportDeviceProfile) => void;
  onRejected?: (detail: string) => void;
  detectDevice?: () => ViewportDeviceProfile;
};

export class ViewportSync {
  private readonly measure: () => ViewportSize;
  private readonly resize: ViewportSyncOptions['resize'];
  private readonly viewportPolicy: ViewportPolicyBounds;
  private readonly debounceMs: number;
  private readonly isDeferred: () => boolean;
  private readonly onApplied?: (size: ViewportSize, device: ViewportDeviceProfile) => void;
  private readonly onRejected?: (detail: string) => void;
  private readonly detectDevice: () => ViewportDeviceProfile;

  private remoteW = 0;
  private remoteH = 0;
  private deviceProfile: ViewportDeviceProfile = detectViewportDeviceProfile();
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeInFlight = false;
  private pending = false;
  private consecutiveRejects = 0;
  private observer: ResizeObserver | null = null;
  private viewportListenersAttached = false;
  private disposed = false;

  /** Cap automatic retries after applied:false / throw so permanent faults do not spin. */
  static readonly MAX_REJECT_RETRIES = 5;

  constructor(options: ViewportSyncOptions) {
    this.measure = options.measure;
    this.resize = options.resize;
    this.viewportPolicy = options.viewportPolicy;
    this.debounceMs = options.debounceMs ?? 320;
    this.isDeferred = options.isDeferred ?? (() => false);
    this.onApplied = options.onApplied;
    this.onRejected = options.onRejected;
    this.detectDevice = options.detectDevice ?? detectViewportDeviceProfile;
  }

  /** Last confirmed remote viewport (after applied resize / seed from start). */
  get remoteSize(): ViewportSize {
    return { width: this.remoteW, height: this.remoteH };
  }

  get remoteDevice(): ViewportDeviceProfile {
    return this.deviceProfile;
  }

  /** Seed confirmed size after Start / boot (already measured for launch). */
  seedRemote(width: number, height: number, device?: ViewportDeviceProfile): void {
    this.remoteW = width;
    this.remoteH = height;
    this.consecutiveRejects = 0;
    if (device) {
      this.deviceProfile = device;
    }
    // Local surface must lockstep immediately — do not wait for a later ResizeObserver
    // tick (seed often matches host measure, so schedule() would no-op and leave a
    // stale CSS stage from client construction defaults).
    this.onApplied?.({ width: this.remoteW, height: this.remoteH }, this.deviceProfile);
  }

  /** Observe the CSS layout host — never the inner surface stage / iframe. */
  observe(element: Element): void {
    this.observer?.disconnect();
    this.observer = new ResizeObserver(() => {
      const size = this.measure();
      this.schedule(size.width, size.height);
    });
    this.observer.observe(element);
    this.attachViewportListeners();
  }

  /**
   * Debounced remote resize. Coalesces while in flight; flushes latest on complete.
   * No-ops when within ε of the confirmed remote size and device is unchanged.
   */
  schedule(rawW: number, rawH: number): void {
    if (this.disposed) {
      return;
    }
    if (this.isDeferred()) {
      this.pending = true;
      return;
    }
    if (this.resizeInFlight) {
      this.pending = true;
      return;
    }

    const validated = validateResizeViewport(rawW, rawH, this.viewportPolicy);
    if (!validated.ok) {
      return;
    }
    const { width: w, height: h } = validated;
    const nextProfile = this.detectDevice();
    if (
      viewportSizesClose(w, h, this.remoteW, this.remoteH)
      && deviceProfilesEqual(this.deviceProfile, nextProfile)
    ) {
      return;
    }

    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    const delay = this.rejectBackoffMs();
    this.resizeTimer = setTimeout(() => {
      void this.invoke();
    }, delay);
  }

  /** After IME closes (or deferral clears), apply any layout change deferred. */
  flushPending(): void {
    if (!this.pending || this.isDeferred() || this.disposed) {
      return;
    }
    this.pending = false;
    const size = this.measure();
    this.schedule(size.width, size.height);
  }

  dispose(): void {
    this.disposed = true;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.observer?.disconnect();
    this.observer = null;
    this.detachViewportListeners();
  }

  private readonly onViewportEnvChange = (): void => {
    const size = this.measure();
    this.schedule(size.width, size.height);
  };

  private attachViewportListeners(): void {
    if (this.viewportListenersAttached || typeof window === 'undefined') {
      return;
    }
    this.viewportListenersAttached = true;
    window.addEventListener('resize', this.onViewportEnvChange);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', this.onViewportEnvChange);
      vv.addEventListener('scroll', this.onViewportEnvChange);
    }
  }

  private detachViewportListeners(): void {
    if (!this.viewportListenersAttached || typeof window === 'undefined') {
      return;
    }
    this.viewportListenersAttached = false;
    window.removeEventListener('resize', this.onViewportEnvChange);
    const vv = window.visualViewport;
    if (vv) {
      vv.removeEventListener('resize', this.onViewportEnvChange);
      vv.removeEventListener('scroll', this.onViewportEnvChange);
    }
  }

  private rejectBackoffMs(): number {
    if (this.consecutiveRejects <= 0) {
      return this.debounceMs;
    }
    const factor = Math.min(8, 2 ** Math.min(this.consecutiveRejects, 3));
    return Math.min(2_000, this.debounceMs * factor);
  }

  private async invoke(): Promise<void> {
    if (this.disposed || this.resizeInFlight) {
      return;
    }
    if (this.isDeferred()) {
      this.pending = true;
      return;
    }

    const latest = this.measure();
    const validated = validateResizeViewport(latest.width, latest.height, this.viewportPolicy);
    if (!validated.ok) {
      return;
    }
    const targetW = validated.width;
    const targetH = validated.height;
    const profile = this.detectDevice();
    if (
      viewportSizesClose(targetW, targetH, this.remoteW, this.remoteH)
      && deviceProfilesEqual(this.deviceProfile, profile)
    ) {
      this.consecutiveRejects = 0;
      return;
    }

    this.resizeInFlight = true;
    try {
      const result = await this.resize({ width: targetW, height: targetH }, profile);
      if (this.disposed) {
        return;
      }
      if (result.applied) {
        this.remoteW = targetW;
        this.remoteH = targetH;
        this.deviceProfile = profile;
        this.consecutiveRejects = 0;
        this.onApplied?.({ width: targetW, height: targetH }, profile);
      } else {
        const detail = result.message || result.errorCode || 'resize rejected';
        this.onRejected?.(String(detail));
        this.consecutiveRejects++;
        if (this.consecutiveRejects <= ViewportSync.MAX_REJECT_RETRIES) {
          this.pending = true;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onRejected?.(message);
      this.consecutiveRejects++;
      if (this.consecutiveRejects <= ViewportSync.MAX_REJECT_RETRIES) {
        this.pending = true;
      }
    } finally {
      this.resizeInFlight = false;
      if (this.pending && !this.isDeferred() && !this.disposed) {
        this.pending = false;
        const size = this.measure();
        this.schedule(size.width, size.height);
      }
    }
  }
}

export { measureHostElement };
