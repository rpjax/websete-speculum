/**
 * Wires {@link BrowserPool} (WP13, §5.13) into the Patchright launch path.
 *
 * `launchPersistentContext` ties a browser *process* to exactly one context at launch —
 * there is no separate "process, then context" step to pool the way `chromium.launch()` +
 * `browser.newContext()` would allow. {@link PooledChromeProcess} adapts that 1:1
 * process↔context model to `BrowserPool`'s framework-agnostic contract: `newContext()`
 * cannot create a second isolated context on an already-persistent-context browser, so it
 * returns a no-op; the real teardown (Chrome context close + Xorg `Display.dispose()`)
 * happens once, in `close()`, invoked by `AcquiredBrowser.release()` (PP-SESS-2 — a
 * released instance is destroyed, never recycled or handed to a second session).
 *
 * A pre-warmed {@link Display} is allocated at a fixed width×height and — by design
 * (`Display.recreate` is removed, see `Display.ts`) — can never be resized after start.
 * The pool is therefore geometry-locked to the **first** PageProjection launch's
 * `viewportPolicy` max; a later launch requesting a different max viewport is a pool miss
 * and falls back to a direct, unpooled launch (correctness over the E10 boot-time win for
 * that one session — never a wrong-sized display, never a blocked launch).
 */
import { BrowserPool, type AcquiredBrowser, type PooledBrowserContext, type PooledBrowserProcess } from './BrowserPool';
import { Display, DisplayAllocator } from './Display';
import { launchChrome, closeChrome, type ChromeHandle } from './ChromeRuntime';

export class PooledChromeProcess implements PooledBrowserProcess {
  constructor(
    readonly display: Display,
    readonly chrome: ChromeHandle,
  ) {}

  async newContext(): Promise<PooledBrowserContext> {
    return { close: async () => {} };
  }

  async close(): Promise<void> {
    await closeChrome(this.chrome, { removeUserDataDir: true }).catch(() => {});
    await this.display.dispose().catch(() => {});
  }
}

let poolTagCounter = 0;

/** Injectable so tests can exercise the geometry-lock/fallback policy without real Xorg/Chrome. */
export type GenericBrowserLaunchFactory = (
  width: number,
  height: number,
  displays: DisplayAllocator,
) => Promise<PooledBrowserProcess>;

/**
 * One process-wide pool instance (task-mandated: "if BrowserPool isn't thread-safe for
 * concurrent sessions, document and use one pool instance carefully"). `BrowserPool`'s own
 * state (`ready`/`launching` arrays) is only ever mutated synchronously between `await`
 * points, so concurrent `acquire()` calls from different sessions are already safe; this
 * registry adds the single-instance-and-geometry-lock policy PageProjection needs on top,
 * and every failure mode (mismatch, exhaustion, launch error) resolves to `null` — the
 * caller's existing direct-launch path — never to a session blocked on pool state.
 */
export class BrowserPoolRegistry {
  private pool: BrowserPool | null = null;
  private geometry: { maxWidth: number; maxHeight: number } | null = null;

  constructor(private readonly launchFactory: GenericBrowserLaunchFactory = launchGenericChromeProcess) {}

  /**
   * Returns a pooled, never-navigated {@link AcquiredBrowser} or `null` when pooling is
   * disabled, exhausted-and-launch-failed, or geometry-locked to a different size than
   * requested. Never throws.
   */
  async tryAcquire(args: {
    size: number;
    refillPerSec: number;
    maxWidth: number;
    maxHeight: number;
    displays: DisplayAllocator;
  }): Promise<AcquiredBrowser | null> {
    if (args.size <= 0) return null;

    if (!this.pool) {
      this.geometry = { maxWidth: args.maxWidth, maxHeight: args.maxHeight };
      this.pool = new BrowserPool({
        size: args.size,
        refillPerSec: Math.max(1, args.refillPerSec),
        launch: () => this.launchFactory(args.maxWidth, args.maxHeight, args.displays),
      });
      this.pool.startAutoRefill();
      void this.pool.warmUp();
    }

    if (this.geometry!.maxWidth !== args.maxWidth || this.geometry!.maxHeight !== args.maxHeight) {
      return null; // this session's Display could never be resized to match the pool's
    }

    try {
      return await this.pool.acquire();
    } catch {
      return null; // pool exhaustion + on-demand launch failure — direct launch is the fallback
    }
  }

  /** Test-only teardown; never called on the request path. */
  async disposeForTests(): Promise<void> {
    await this.pool?.dispose();
    this.pool = null;
    this.geometry = null;
  }
}

async function launchGenericChromeProcess(
  width: number,
  height: number,
  displays: DisplayAllocator,
): Promise<PooledBrowserProcess> {
  const displayNum = displays.allocate();
  const display = await Display.start(displayNum, width, height);
  const tag = `pool-${++poolTagCounter}`;
  // Generic, credential-less defaults — PatchrightBrowserSession re-applies the real
  // session's locale/timezone/colorScheme/geolocation/language once acquired (see
  // `adoptPooledBrowser`); nothing session-identifying is ever pre-baked here.
  const chrome = await launchChrome({
    sessionId: tag,
    displayEnv: display.displayEnv,
    width,
    height,
    locale: 'en-US',
    language: 'en-US',
    timeZoneId: 'UTC',
    colorScheme: 'no-preference',
  });
  return new PooledChromeProcess(display, chrome);
}

/**
 * Process-wide singleton — every {@link PatchrightBrowserSession} launch shares it (see
 * class doc for the single-instance rationale).
 */
export const sharedBrowserPool = new BrowserPoolRegistry();
