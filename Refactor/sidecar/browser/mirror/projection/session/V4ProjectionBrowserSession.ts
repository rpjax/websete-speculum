/**
 * PageProjection V4 BrowserSession — Patchright Chromium + in-page producer + owned data plane.
 *
 * **Temporary** until production cutover (`docs/page-projection/spec/roadmap.md` CUTOVER-SESSION). Replaces
 * `PatchrightBrowserSession` / `LivePageProjection` that day — delete the dual path.
 * Must grow to the **full** `BrowserSession` contract (input, cookies, eval, resize,
 * permissions, probes, …) as V4 work, not by preserving legado. Lab-incomplete is not
 * a cutover license.
 */

import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'patchright';
import {
  type BrowserEvalResult,
  type BrowserInput,
  type BrowserLaunchOptions,
  type BrowserProbeRequest,
  type BrowserProbeResult,
  type BrowserReadyInfo,
  type BrowserResizeRequest,
  type BrowserResizeResult,
  type BrowserSession,
  type BrowserSessionEvents,
  type BrowserSessionFactory,
  type BrowserState,
  type BrowserStatus,
  type CookieNormalizeStats,
} from '../../../BrowserSession';
import { buildConfigPreScript } from '../inject/buildConfigPreScript';
import { loadInpageScript } from '../inject/loadInpageScript';
import { captureVirtualSnapshot, coherentSnapshotExpression } from '../lab/virtualSnapshot';
import { startCpuProfile, stopCpuProfile } from '../lab/cpuProfile';
import {
  isProjectionTelemetryMessage,
  LAB_TELEMETRY_DEFAULTS,
  type ProjectionTelemetryConfig,
  type ProjectionTelemetryMessage,
} from '../models/telemetry';
import type { TableLiveOracleResult } from '../models/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '../models/cssomTableLiveOracle';
import { PlaneChannel } from '../plane';
import { ProjectionDataPlaneHost } from './projectionDataPlaneHost';

function chromeArgs(): string[] {
  return [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

export type V4ProjectionFactoryOptions = {
  headless: boolean;
};

function peekFrameHeader(buf: Uint8Array): { generation: number; sequence: number } | null {
  if (buf.length < 12) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint16(0, true) !== 0x5050) return null;
  return { generation: view.getUint32(4, true), sequence: view.getUint32(8, true) };
}

export class V4ProjectionBrowserSession implements BrowserSession {
  private open = false;
  private width = 1280;
  private height = 720;
  private url = 'about:blank';
  private launchOpts: BrowserLaunchOptions | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private generation = 1;
  private cpuAllowed = false;
  private cpuRunning = false;
  private readonly dataPlane = new ProjectionDataPlaneHost();
  private readonly headless: boolean;

  constructor(
    readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
    factoryOpts: V4ProjectionFactoryOptions,
  ) {
    this.headless = factoryOpts.headless;
    this.dataPlane.dataPlane.setHandler((channel, payload) => {
      if (channel === PlaneChannel.Frame) {
        const header = peekFrameHeader(payload);
        this.events.onPageProjectionDiff?.({
          sequence: header?.sequence ?? 0,
          generation: header?.generation ?? 0,
          plane: '',
          operation: '',
          timestampMs: Date.now(),
          body: payload,
        });
        return;
      }
      if (channel === PlaneChannel.Telemetry) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(payload));
        } catch {
          return;
        }
        if (!isProjectionTelemetryMessage(parsed)) return;
        this.events.onPageProjectionTelemetry?.(parsed);
      }
    });
  }

  async launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo> {
    this.launchOpts = options;
    this.width = options.width;
    this.height = options.height;
    this.cpuAllowed = options.cpuProfiling === true;
    if (options.mirrorMode !== 'pageProjection') {
      throw new Error('V4ProjectionBrowserSession requires mirrorMode pageProjection');
    }
    loadInpageScript();
    await this.dataPlane.listen();
    const browser = await chromium.launch({ headless: this.headless, args: chromeArgs() });
    this.browser = browser;
    this.context = await browser.newContext({
      viewport: { width: this.width, height: this.height },
    });
    this.generation = 1;
    this.open = true;
    this.events.onLocationChanged(this.url);
    return { width: this.width, height: this.height };
  }

  async stop(): Promise<void> {
    this.open = false;
    this.cdpSession = null;
    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    if (browser) await browser.close();
    await this.dataPlane.close();
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  async getStatus(): Promise<BrowserStatus> {
    return {
      isOpen: this.open,
      tabCount: this.open ? 1 : 0,
      url: this.url,
      resizing: false,
      width: this.width,
      height: this.height,
      displayWidth: 0,
      displayHeight: 0,
      chromeWidth: this.open ? this.width : 0,
      chromeHeight: this.open ? this.height : 0,
    };
  }

  async restoreState(_state: BrowserState): Promise<CookieNormalizeStats> {
    return { total: 0, skipped: 0, normalized: 0, applied: 0, failedIndividual: 0 };
  }

  async exportState(): Promise<BrowserState> {
    return { cookies: [], localStorage: [], idbRecords: [], history: [] };
  }

  async navigate(url: string): Promise<void> {
    const opts = this.requireLaunch();
    const dataPlaneUrl = this.dataPlane.listenUrl;
    if (this.page) {
      this.generation += 1;
      await this.page.close();
      this.cdpSession = null;
    }
    this.page = await this.freshPage(dataPlaneUrl, opts);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    this.url = url;
    this.events.onLocationChanged(url);
  }

  async refresh(): Promise<void> {
    if (this.url && this.url !== 'about:blank') await this.navigate(this.url);
  }

  async resize(request: BrowserResizeRequest): Promise<BrowserResizeResult> {
    this.width = request.width;
    this.height = request.height;
    await this.page?.setViewportSize({ width: this.width, height: this.height });
    return { ok: true, width: this.width, height: this.height, chromeWidth: this.width, chromeHeight: this.height };
  }

  async probe(_request: BrowserProbeRequest): Promise<BrowserProbeResult> {
    return { ok: false, errorCode: 'unsupported', message: 'use PageProjection probes on this session' };
  }

  async evaluate(code: string): Promise<BrowserEvalResult> {
    try {
      const value = await this.requirePage().evaluate(code);
      return { ok: true, value: typeof value === 'string' ? value : JSON.stringify(value) };
    } catch (err) {
      return { ok: false, value: '', errorMessage: err instanceof Error ? err.message : String(err) };
    }
  }

  async pushInput(_input: BrowserInput): Promise<void> {
    // V4 lab session does not emulate OS input; lab UI applies on the client surface.
  }

  async pushCameraFrame(_frame: Uint8Array): Promise<void> {}
  async pushMicrophoneAudio(_chunk: Uint8Array): Promise<void> {}

  async haltProjectionWorld(): Promise<{ ok: boolean; reason?: string }> {
    return this.callProducer<{ ok: boolean; reason?: string }>(
      `(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.haltWorld !== 'function') return { ok: false, reason: 'producer missing' };
        p.haltWorld();
        return { ok: true };
      })()`,
    );
  }

  async resumeProjectionWorld(): Promise<{ ok: boolean; reason?: string }> {
    return this.callProducer<{ ok: boolean; reason?: string }>(
      `(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.resumeWorld !== 'function') return { ok: false, reason: 'producer missing' };
        p.resumeWorld();
        return { ok: true };
      })()`,
    );
  }

  async flushProjectionFrame(): Promise<{
    ok: boolean;
    generation?: number;
    sequence?: number;
    reason?: string;
  }> {
    return this.callProducer(
      `(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.flushFrame !== 'function') return { ok: false, reason: 'producer missing' };
        const r = p.flushFrame();
        return { ok: true, generation: r.generation, sequence: r.sequence };
      })()`,
    );
  }

  async snapshotProjectionVirtual(opts?: { includeTree?: boolean }): Promise<{
    ok: boolean;
    generation?: number;
    sequence?: number;
    tableSize?: number;
    tree?: unknown;
    reason?: string;
  }> {
    const page = this.requirePage();
    const meta = await this.callProducer<{
      ok: boolean;
      generation?: number;
      sequence?: number;
      tableSize?: number;
      reason?: string;
    }>(
      `(() => {
        const p = globalThis.__speculumProjection;
        if (!p) return { ok: false, reason: 'producer missing' };
        return {
          ok: true,
          generation: p.domNodes.generation,
          sequence: p.frameEmitter.currentSequence,
          tableSize: p.table.size,
        };
      })()`,
    );
    if (!meta.ok) return meta;
    if (opts?.includeTree === false) return meta;
    try {
      const tree = await captureVirtualSnapshot(page);
      return { ...meta, tree };
    } catch (err) {
      return { ...meta, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async compareProjectionTableToLiveDom(): Promise<{
    ok: boolean;
    result?: TableLiveOracleResult;
    reason?: string;
  }> {
    const raw = await this.callProducer<{ ok: boolean; result?: TableLiveOracleResult; reason?: string }>(
      `(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.compareTableToLiveDom !== 'function') {
          return { ok: false, reason: 'compareTableToLiveDom missing' };
        }
        return { ok: true, result: p.compareTableToLiveDom() };
      })()`,
    );
    return raw;
  }

  async flushProjectionSnapshot(opts?: {
    includeTree?: boolean;
    cssom?: 'none' | 'committed' | 'scan';
  }): Promise<{
    ok: boolean;
    generation?: number;
    sequence?: number;
    tableSize?: number;
    o2?: TableLiveOracleResult;
    table?: { rowCount: number; tableHash: string };
    cssomO2?: CssomTableLiveOracleResult | null;
    tree?: unknown;
    reason?: string;
  }> {
    try {
      return (await this.requirePage().evaluate(
        coherentSnapshotExpression(opts?.includeTree !== false, opts?.cssom ?? 'none'),
      )) as {
        ok: boolean;
        generation?: number;
        sequence?: number;
        tableSize?: number;
        o2?: TableLiveOracleResult;
        table?: { rowCount: number; tableHash: string };
        cssomO2?: CssomTableLiveOracleResult | null;
        tree?: unknown;
        reason?: string;
      };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async startCpuProfile(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.cpuAllowed) return { ok: false, reason: 'cpuProfiling disabled at launch' };
    if (this.cpuRunning) return { ok: false, reason: 'cpu profile already running' };
    const cdp = await this.ensureCdp();
    await startCpuProfile(cdp);
    this.cpuRunning = true;
    return { ok: true };
  }

  async stopCpuProfile(): Promise<{
    ok: boolean;
    summary?: { totalSamples: number; wallMs: number; approxCpuMs: number; ourCode: { totalPct: number; totalMs: number } };
    profileBytes?: Uint8Array;
    reason?: string;
  }> {
    if (!this.cpuRunning) return { ok: false, reason: 'cpu profile not running' };
    const cdp = await this.ensureCdp();
    const { raw, summary } = await stopCpuProfile(cdp, 20);
    this.cpuRunning = false;
    return {
      ok: true,
      summary: {
        totalSamples: summary.totalSamples,
        wallMs: summary.wallMs,
        approxCpuMs: summary.approxCpuMs,
        ourCode: { totalPct: summary.ourCode.totalPct, totalMs: summary.ourCode.totalMs },
      },
      profileBytes: new TextEncoder().encode(JSON.stringify(raw)),
    };
  }

  sendPageProjectionControl(message: Record<string, unknown>): void {
    this.dataPlane.sendControl(message);
  }

  private async freshPage(dataPlaneUrl: string, options: BrowserLaunchOptions): Promise<Page> {
    const context = this.context;
    if (!context) throw new Error('context not open');
    const p = await context.newPage();
    p.on('console', (msg) => this.events.onConsole(consoleLevel(msg.type()), msg.text()));
    p.on('pageerror', (err) => this.events.onConsole(3, err.message));
    const telemetry = (options.projectionTelemetry ?? LAB_TELEMETRY_DEFAULTS) as Partial<ProjectionTelemetryConfig>;
    const configPre = buildConfigPreScript({
      transport: 'loopback',
      dataPlaneUrl,
      frameRateHz: options.frameRateHz ?? 60,
      telemetry,
      generation: this.generation,
      cssomPollHz: telemetry.cssomPoll === false ? 0 : 5,
    });
    await p.addInitScript({ content: configPre });
    await p.addInitScript({ content: loadInpageScript() });
    return p;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('V4ProjectionBrowserSession: page not open');
    return this.page;
  }

  private requireLaunch(): BrowserLaunchOptions {
    if (!this.launchOpts) throw new Error('V4ProjectionBrowserSession: not launched');
    return this.launchOpts;
  }

  private async ensureCdp(): Promise<CDPSession> {
    if (this.cdpSession) return this.cdpSession;
    const context = this.context;
    const page = this.requirePage();
    if (!context) throw new Error('context not open');
    this.cdpSession = await context.newCDPSession(page);
    return this.cdpSession;
  }

  private async callProducer<T extends { ok: boolean; reason?: string }>(expression: string): Promise<T> {
    try {
      return (await this.requirePage().evaluate(expression)) as T;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) } as T;
    }
  }
}

function consoleLevel(type: string): number {
  if (type === 'error') return 3;
  if (type === 'warning') return 2;
  return 1;
}

export function createV4ProjectionBrowserSessionFactory(
  opts: V4ProjectionFactoryOptions,
): BrowserSessionFactory {
  return {
    create(sessionId, events) {
      return new V4ProjectionBrowserSession(sessionId, events, opts);
    },
  };
}

export type { ProjectionTelemetryMessage };
