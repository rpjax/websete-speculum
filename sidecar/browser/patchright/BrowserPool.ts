/**
 * Pre-warmed browser pool — docs/page-projection/spec/engine-redesign.md §5.13, WP13.
 *
 * Boots Chromium instances ahead of any session (E10: session-start Chromium
 * boot MUST NOT sit on the user's critical path). Every pooled instance is
 * **never navigated** before `acquire()` hands it to a session. `release()`
 * always **destroys** the instance — it is never recycled or handed to a
 * second session (PP-SESS-2, K2): pooling clean resources is not sharing
 * state, and getting that wrong is a cross-session data leak.
 *
 * Framework-agnostic by design (`BrowserLaunchFactory` is injectable) so this
 * module is unit-testable without a real Chromium process — see
 * `unit.ts` for the fake-factory tests.
 *
 * **Integration point:** each session's browser *process* boot is normally coupled
 * to its own Xorg display (`Display.ts`) and a `launchPersistentContext` keyed by
 * `sessionId` (`ChromeRuntime.ts`) — `launchPersistentContext` has no separate
 * "process, then context" step, so a pre-warmed instance can only be generic (no
 * session identity baked in) and is adopted, never re-profiled. `BrowserPoolRegistry`
 * (`BrowserPoolRegistry.ts`) adapts that model and is wired into
 * `PatchrightBrowserSession.launch()` for Dom Projection (§5.16 `browserPoolSize`),
 * gated to sessions that never need OS input (uinput binding is incompatible with a
 * generic pre-warmed Display) and geometry-locked to the first observed
 * `viewportPolicy` max (`Display.recreate` is removed by design).
 */

/** A pre-warmed, never-navigated Chromium process. */
export interface PooledBrowserProcess {
  /** Creates a fresh, isolated context/profile on this process — never a copy of a prior session's. */
  newContext(options?: Record<string, unknown>): Promise<PooledBrowserContext>;
  /** Destroys the entire process. Never called twice, never reused after (PP-SESS-2). */
  close(): Promise<void>;
}

export interface PooledBrowserContext {
  close(): Promise<void>;
}

/** Launches one never-navigated Chromium process. Injectable for tests. */
export type BrowserLaunchFactory = () => Promise<PooledBrowserProcess>;

export interface AcquiredBrowser {
  readonly process: PooledBrowserProcess;
  readonly context: PooledBrowserContext;
  /** Closes the context, then destroys the process. Idempotent. Never recycles (PP-SESS-2). */
  release(): Promise<void>;
}

export interface BrowserPoolOptions {
  /** §5.16 `browserPoolSize` — pre-warmed instances held ready. */
  size: number;
  /** §5.16 `browserPoolRefillPerSec` — throttle so a burst of session starts cannot saturate the host. */
  refillPerSec: number;
  launch: BrowserLaunchFactory;
  /** Injectable clock for deterministic throttle tests. Defaults to `Date.now`. */
  now?: () => number;
}

export class BrowserPool {
  private readonly ready: PooledBrowserProcess[] = [];
  private readonly launch: BrowserLaunchFactory;
  private readonly size: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;
  private lastRefillAt = -Infinity;
  private refillTimer: ReturnType<typeof setInterval> | null = null;
  private launching = 0;
  private disposed = false;

  constructor(options: BrowserPoolOptions) {
    if (!Number.isFinite(options.size) || options.size < 0) {
      throw new Error('BrowserPool: size must be a non-negative number');
    }
    if (!Number.isFinite(options.refillPerSec) || options.refillPerSec <= 0) {
      throw new Error('BrowserPool: refillPerSec must be greater than zero');
    }
    this.launch = options.launch;
    this.size = options.size;
    this.refillPerSec = options.refillPerSec;
    this.now = options.now ?? (() => Date.now());
  }

  /** Instances currently pre-warmed and ready to acquire. */
  get availableCount(): number {
    return this.ready.length;
  }

  /** Launches in flight toward `size` (pre-warm start, or a throttled refill). */
  get launchingCount(): number {
    return this.launching;
  }

  /** Pre-warms up to `size` instances immediately. Startup only — not throttled. */
  async warmUp(): Promise<void> {
    const need = this.size - this.ready.length - this.launching;
    if (need <= 0) return;
    await Promise.all(Array.from({ length: need }, () => this.launchOne()));
  }

  /**
   * Attempts exactly one throttled refill if under target size and the
   * `1000 / refillPerSec` interval has elapsed since the last refill.
   * Returns `true` if a launch was started. Safe to call as often as wanted
   * — the throttle, not the caller, decides whether it does anything.
   */
  tryRefill(): boolean {
    if (this.disposed) return false;
    if (this.ready.length + this.launching >= this.size) return false;
    const minIntervalMs = 1000 / this.refillPerSec;
    const nowMs = this.now();
    if (nowMs - this.lastRefillAt < minIntervalMs) return false;
    this.lastRefillAt = nowMs;
    void this.launchOne();
    return true;
  }

  /** Starts the production interval-driven refill loop. Idempotent. */
  startAutoRefill(): void {
    if (this.refillTimer) return;
    const intervalMs = Math.max(1, Math.floor(1000 / this.refillPerSec));
    this.refillTimer = setInterval(() => this.tryRefill(), intervalMs);
  }

  stopAutoRefill(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
  }

  /**
   * Hands a fresh, isolated context off a pre-warmed, never-navigated
   * process. Falls back to an on-demand launch if the pool is exhausted:
   * correctness (isolation) over the E10 boot budget — an exhausted pool is
   * a sizing problem to report (`Session.PoolAcquired` telemetry), never a
   * reason to hand out a used instance.
   */
  async acquire(contextOptions?: Record<string, unknown>): Promise<AcquiredBrowser> {
    if (this.disposed) {
      throw new Error('BrowserPool: acquire after dispose');
    }

    const pooled = this.ready.shift();
    const proc = pooled ?? (await this.launch());
    if (pooled) this.tryRefill(); // opportunistic; startAutoRefill() covers steady-state production

    const context = await proc.newContext(contextOptions);
    let released = false;
    return {
      process: proc,
      context,
      release: async () => {
        if (released) return;
        released = true;
        await context.close().catch(() => {});
        await proc.close().catch(() => {}); // PP-SESS-2 — destroy, never recycle
      },
    };
  }

  /** Shutdown — destroys every pre-warmed instance. Nothing is recycled. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopAutoRefill();
    const pending = this.ready.splice(0, this.ready.length);
    await Promise.all(pending.map((p) => p.close().catch(() => {})));
  }

  private async launchOne(): Promise<void> {
    if (this.disposed) return;
    this.launching++;
    try {
      const proc = await this.launch();
      if (this.disposed) {
        await proc.close().catch(() => {});
        return;
      }
      this.ready.push(proc);
    } finally {
      this.launching--;
    }
  }
}
