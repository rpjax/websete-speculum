/**
 * Patchright Chromium for Virtual — injects real virtual.js + config pre-script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'patchright';
import { buildConfigPreScript } from '../inject/buildConfigPreScript';
import { loadInpageScript } from '../inject/loadInpageScript';
import { LAB_TELEMETRY_DEFAULTS, type ProjectionTelemetryConfig } from '../models/telemetry';

export type LaunchVirtualBrowserOptions = {
  dataPlaneUrl: string;
  startUrl: string;
  headless: boolean;
  frameRateHz?: number;
  telemetry?: Record<string, unknown>;
};

export type VirtualBrowserHandle = {
  navigate(url: string): Promise<void>;
  close(): Promise<void>;
  readonly page: Page;
  /** Lazily created, cached for the life of this handle — CDP profiling (lab/cpuProfile.ts). */
  cdp(): Promise<CDPSession>;
};

function chromeArgs(): string[] {
  // Parent §5.3.4 — background timer throttling must be off for Virtual.
  return [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

export async function launchVirtualBrowser(
  opts: LaunchVirtualBrowserOptions,
): Promise<VirtualBrowserHandle> {
  // Ensure bundle exists (clear message if build:virtual was skipped).
  loadInpageScript();
  const mainScript = loadInpageScript();

  const browser: Browser = await chromium.launch({
    headless: opts.headless,
    args: chromeArgs(),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  // Lazily created (see `cdp()` below) — only ever needed for CDP CPU profiling
  // (`lab/cpuProfile.ts`'s `Profiler.*` calls), never for injecting page scripts. Invalidated by
  // `navigate()` below since it is bound to a specific (soon to be replaced) `Page`.
  let cdpSession: CDPSession | null = null;
  let generation = 1;
  let page: Page = await freshPage();

  async function freshPage(): Promise<Page> {
    const p = await context.newPage();
    p.on('console', (msg) => console.log('[virtual console]', msg.type(), msg.text()));
    p.on('pageerror', (err) => console.log('[virtual pageerror]', err.message));
    const configPre = buildConfigPreScript({
      transport: 'loopback',
      dataPlaneUrl: opts.dataPlaneUrl,
      frameRateHz: opts.frameRateHz ?? 60,
      telemetry: (opts.telemetry ?? LAB_TELEMETRY_DEFAULTS) as Partial<ProjectionTelemetryConfig>,
      generation,
    });
    await p.addInitScript({ content: configPre });
    await p.addInitScript({ content: mainScript });
    return p;
  }

  await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  return {
    get page(): Page {
      return page;
    },
    async navigate(url: string): Promise<void> {
      // §1.2/§4.1 EPOCH_RESET trigger — a hard navigation within this lab session is exactly
      // "this generation is over, nothing carries forward" (frame-protocol.md decision log,
      // 2026-08-13 "Resync"). Isolated repro (2026-08-14, chasing the "hasProjection: false" boot
      // regression) proved raw CDP `Page.addScriptToEvaluateOnNewDocument` does not survive a
      // navigation under patchright — registering `globalThis.__x = 42` this way and then
      // `page.goto('about:blank')` left `__x` `undefined`. That was this function's original
      // mechanism (chosen for its removal API, so a bumped `generation` could replace the old
      // config without leaking it) — it silently never re-ran `bootstrap.ts` after the very first
      // navigation, so `__speculumProjection` was never set again and every later frame/telemetry
      // wait timed out with zero page errors to explain why.
      //
      // Playwright's own `page.addInitScript()` reliably re-runs on every future navigation but
      // has no removal API and, worse, *accumulates*: re-registering a fresh (config, main) pair
      // on the *same* `Page` interleaves as [config1, main1, config2, main2] — `main1` still runs
      // before `config2` (registration order is fixed), reads the stale generation, and
      // `bootstrap.ts`'s own idempotency guard (`if (globalThis.__speculumProjection) return;`)
      // then blocks `main2` from ever re-initializing with the fresh one. A brand-new `Page` has
      // no accumulated scripts at all, so registering exactly one (config, main) pair on it — same
      // as the very first navigation — is the only ordering that is correct for every hard
      // navigation, not just the first.
      //
      // Close the old `Page` *before* creating the new one, not after: a real browser navigation
      // destroys the old document's JS realm (and its running `frameClock`/`frameEmitter`)
      // synchronously as part of the navigation commit, so there is never a moment where two
      // generations are both alive and emitting. Two live `Page`s briefly coexisting here would
      // recreate exactly that impossible-in-production race — the old page's still-ticking
      // producer emitting one more `generation: 1` frame *after* the new page's `generation: 2`
      // bootstrap resync already reached the data plane, stomping `session.ts`'s last-observed
      // generation back down (found via the smoke suite's EPOCH_RESET gate, 2026-08-14).
      generation += 1;
      await page.close();
      cdpSession = null;
      page = await freshPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    },
    async close(): Promise<void> {
      await browser.close();
    },
    async cdp(): Promise<CDPSession> {
      if (cdpSession === null) cdpSession = await context.newCDPSession(page);
      return cdpSession;
    },
  };
}

/** Resolve lab static / fixture roots for both ts-node and compiled dist layouts. */
export function labAssetRoots(): { staticDir: string; fixturesDir: string } {
  const candidates = [
    path.join(__dirname, 'static'),
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static'),
    path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'lab', 'static'),
  ];
  const staticDir =
    candidates.find((p) => fs.existsSync(p)) ??
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static');
  return {
    staticDir,
    fixturesDir: path.join(staticDir, 'fixtures'),
  };
}
