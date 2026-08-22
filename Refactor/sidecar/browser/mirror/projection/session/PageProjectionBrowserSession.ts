/**
 * PageProjectionBrowserSession (sealed contract) — Patchright Chromium + in-page producer + owned data plane.
 *
 * Implements sealed IPageProjectionBrowserSession; temporary file path until Live flip (`docs/page-projection/spec/roadmap.md` CUTOVER-SESSION). Replaces
 * Sealed Live path — replace any leftover Patchright video dual path; do not revive DomMap.
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
import {
  loadSnapshotScriptForEvaluate,
  snapshotContextEvaluateExpression,
} from './snapshotEvaluate';
import {
  isProjectionTelemetryMessage,
  LAB_TELEMETRY_DEFAULTS,
  type ProjectionTelemetryConfig,
  type ProjectionTelemetryMessage,
} from '@speculum/page-projection/core/telemetry';
import type { TableLiveOracleResult } from '@speculum/page-projection/core/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '@speculum/page-projection/core/cssomTableLiveOracle';
import type { FormControlSnap } from '@speculum/page-projection/core/formControlSnap';
import { PlaneChannel } from '@speculum/page-projection/core/plane';
import { peekFrameHeader } from '@speculum/page-projection/core/decode';
import { ProjectionDataPlaneHost } from './projectionDataPlaneHost';
import { CdpBindingDataPlaneHost } from './cdpBindingDataPlaneHost';
import { installDocumentResponseHook, cspDocumentMutator } from './csp/documentResponseHook';
import { createScriptInjectMutator } from './csp/scriptInjectMutator';
import { PageProjectionInputDispatch } from '../input/pageProjectionInputDispatch';
import { EditableFocus } from '../../../patchright/EditableFocus';
import { matchesAllowedDomain } from '../../../patchright/Navigation';
import type { DomInputIngress } from '@speculum/page-projection/core/input/intentTypes';
import type {
  StateSnapshotOpts,
  StateSnapshotResult,
  PageProjectionResyncRequest,
  PageProjectionTelemetrySnapshot,
  StopCpuProfileResult,
} from '../../../contracts';

function chromeArgs(): string[] {
  return [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

/** Optional lab/host probe adapters — session must not import `lab/` directly. */
export type PageProjectionProbes = {
  startCpuProfile?: (cdp: CDPSession) => Promise<void>;
  stopCpuProfile?: (
    cdp: CDPSession,
    topN: number,
  ) => Promise<{
    raw: unknown;
    summary: {
      totalSamples: number;
      wallMs: number;
      approxCpuMs: number;
      ourCode: { totalPct: number; totalMs: number };
    };
  }>;
};

export type PageProjectionFactoryOptions = {
  headless: boolean;
  probes?: PageProjectionProbes;
};

export class PageProjectionBrowserSession {
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
  private inputDispatch: PageProjectionInputDispatch | null = null;
  private readonly editableFocus: EditableFocus;
  private readonly dataPlane = new ProjectionDataPlaneHost();
  private readonly cdpPlane = new CdpBindingDataPlaneHost();
  private dataPlaneMode: 'cdp' | 'loopback' = 'cdp';
  private readonly headless: boolean;
  private readonly probes: PageProjectionProbes;

  constructor(
    readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
    factoryOpts: PageProjectionFactoryOptions,
  ) {
    this.headless = factoryOpts.headless;
    this.probes = factoryOpts.probes ?? {};
    this.editableFocus = new EditableFocus(events);
    const onPlane = (channel: number, payload: Uint8Array) => {
      if (channel === PlaneChannel.Frame) {
        const header = peekFrameHeader(payload);
        this.events.onPageProjectionFrame?.({
          sequence: header?.sequence ?? 0,
          generation: header?.generation ?? 0,
          plane: '',
          operation: '',
          timestampMs: Date.now(),
          body: payload,
          contextId: 1,
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
    };
    this.dataPlane.dataPlane.setHandler(onPlane);
    this.cdpPlane.setHandler(onPlane);
  }

  async launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo> {
    this.launchOpts = options;
    this.width = options.width;
    this.height = options.height;
    this.cpuAllowed = options.cpuProfiling === true;
    this.dataPlaneMode = options.projectionDataPlane === 'loopback' ? 'loopback' : 'cdp';
    if (options.mirrorMode !== 'pageProjection') {
      throw new Error('PageProjectionBrowserSession requires mirrorMode pageProjection');
    }
    loadInpageScript();
    if (this.dataPlaneMode === 'loopback') {
      await this.dataPlane.listen();
    }
    const browser = await chromium.launch({ headless: this.headless, args: chromeArgs() });
    this.browser = browser;
    this.context = await browser.newContext({
      viewport: { width: this.width, height: this.height },
      locale: options.locale || undefined,
      timezoneId: options.timeZoneId || undefined,
      colorScheme: options.colorScheme === 'no-preference' ? undefined : options.colorScheme,
      geolocation: options.geolocation
        ? {
            latitude: options.geolocation.latitude,
            longitude: options.geolocation.longitude,
            accuracy: options.geolocation.accuracy,
          }
        : undefined,
      userAgent: options.device?.userAgentProfile || undefined,
    });
    if (this.dataPlaneMode === 'cdp') {
      await this.cdpPlane.attach(this.context);
    }
    browser.on('disconnected', () => {
      if (!this.open) return;
      this.open = false;
      this.events.onCrash({
        errorCode: 'browser_disconnected',
        phase: 'runtime',
        message: 'chromium disconnected',
      });
    });
    this.generation = 1;
    this.open = true;
    this.events.onLocationChanged(this.url);
    return { width: this.width, height: this.height };
  }

  async stop(): Promise<void> {
    this.editableFocus.stop();
    this.open = false;
    this.cdpSession = null;
    this.inputDispatch = null;
    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    if (browser) await browser.close();
    this.cdpPlane.close();
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

  async restoreState(state: BrowserState): Promise<CookieNormalizeStats> {
    const cookies = state.cookies ?? [];
    const total = cookies.length;
    if (!this.context || total === 0) {
      return { total, skipped: total, normalized: 0, applied: 0, failedIndividual: 0 };
    }
    let applied = 0;
    let failed = 0;
    for (const c of cookies) {
      try {
        await this.context.addCookies([
          {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None' | undefined) ?? 'Lax',
          },
        ]);
        applied += 1;
      } catch {
        failed += 1;
      }
    }
    return { total, skipped: 0, normalized: applied + failed, applied, failedIndividual: failed };
  }

  async exportState(): Promise<BrowserState> {
    if (!this.context) {
      return { cookies: [], localStorage: [], idbRecords: [], history: [] };
    }
    const raw = await this.context.cookies();
    return {
      cookies: raw.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      })),
      localStorage: [],
      idbRecords: [],
      history: [],
    };
  }

  async navigate(url: string): Promise<void> {
    const opts = this.requireLaunch();
    const dataPlaneUrl = this.dataPlane.listenUrl;
    if (this.page) {
      this.generation += 1;
      this.inputDispatch = null;
      await this.page.close();
      this.cdpSession = null;
    }
    this.page = await this.freshPage(dataPlaneUrl, opts);
    this.inputDispatch = new PageProjectionInputDispatch(this.page);
    const allowed = opts.allowedNavigationDomains;
    if (allowed && allowed.length > 0) {
      try {
        const host = new URL(url).hostname;
        if (!matchesAllowedDomain(host, allowed)) {
          this.events.onMainFrameNavigationBlocked(url);
          throw Object.assign(new Error(`navigation blocked: ${host}`), {
            code: 'PERMISSION_DENIED',
            errorCode: 'navigation_blocked',
            phase: 'navigate',
          });
        }
      } catch (err) {
        if ((err as { errorCode?: string }).errorCode === 'navigation_blocked') throw err;
      }
    }
    this.editableFocus.stop();
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    this.url = this.page.url() || url;
    this.events.onLocationChanged(this.url);
    this.editableFocus.rebind(this.page);
    this.editableFocus.start(this.page);
  }

  async refresh(): Promise<void> {
    if (this.url && this.url !== 'about:blank') await this.navigate(this.url);
  }

  async goBack(): Promise<void> {
    const page = this.page;
    if (!page) return;
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    this.url = page.url();
    this.events.onLocationChanged(this.url);
  }

  async goForward(): Promise<void> {
    const page = this.page;
    if (!page) return;
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    this.url = page.url();
    this.events.onLocationChanged(this.url);
  }

  async resize(request: BrowserResizeRequest): Promise<BrowserResizeResult> {
    this.width = request.width;
    this.height = request.height;
    await this.page?.setViewportSize({ width: this.width, height: this.height });
    return { ok: true, width: this.width, height: this.height, chromeWidth: this.width, chromeHeight: this.height };
  }

  async probe(request: BrowserProbeRequest): Promise<BrowserProbeResult> {
    const data: Record<string, unknown> = {};
    for (const op of request.ops ?? []) {
      if (op === 'tabs') {
        data.tabs = [{ url: this.url, active: true }];
      } else if (op === 'cookies') {
        data.cookies = this.context ? await this.context.cookies() : [];
      } else if (op === 'evaluate' && request.evaluateExpression) {
        const r = await this.evaluate(request.evaluateExpression);
        data.evaluate = r;
      } else if (op === 'dom' && request.domSelector && this.page) {
        data.dom = await this.page.evaluate(
          `(sel) => { const el = document.querySelector(sel); return el ? el.outerHTML.slice(0, 8000) : null; }`,
          request.domSelector,
        );
      }
    }
    return { ok: true, data };
  }

  async evaluate(code: string): Promise<BrowserEvalResult> {
    try {
      const value = await this.requirePage().evaluate(code);
      return { ok: true, value: typeof value === 'string' ? value : JSON.stringify(value) };
    } catch (err) {
      return { ok: false, value: '', errorMessage: err instanceof Error ? err.message : String(err) };
    }
  }

  async pushInput(input: DomInputIngress): Promise<
    { status: 'dispatched' } | { status: 'dropped'; reason: string }
  > {
    if (!this.open || !this.page) {
      throw Object.assign(new Error('PageProjectionBrowserSession: session not live'), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'session_not_live',
        phase: 'input',
      });
    }
    if (!this.inputDispatch) {
      throw Object.assign(new Error('PageProjection input dispatch not ready'), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'input_dispatch_missing',
        phase: 'input',
      });
    }
    return this.inputDispatch.dispatchIngress(input);
  }


  async resolveAndClickDomInput(
    selector: string,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    if (!this.inputDispatch) {
      return { status: 'dropped', reason: 'input_dispatch_missing' };
    }
    return this.inputDispatch.resolveAndClick(selector, contextId);
  }

  async resolveAndTypeDomInput(
    selector: string,
    value: string,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    if (!this.inputDispatch) {
      return { status: 'dropped', reason: 'input_dispatch_missing' };
    }
    return this.inputDispatch.resolveAndType(selector, value, contextId);
  }

  async resolveAndScrollElementDomInput(
    selector: string,
    scrollTop: number,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    if (!this.inputDispatch) {
      return { status: 'dropped', reason: 'input_dispatch_missing' };
    }
    return this.inputDispatch.resolveAndScrollElement(selector, scrollTop, contextId);
  }

  async resolveAndScrollViewportDomInput(
    scrollY: number,
    scrollX: number = 0,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    if (!this.inputDispatch) {
      return { status: 'dropped', reason: 'input_dispatch_missing' };
    }
    return this.inputDispatch.resolveAndScrollViewport(scrollY, scrollX, contextId);
  }

  async pushCameraFrame(_frame: Uint8Array): Promise<void> {}
  async pushMicrophoneAudio(_chunk: Uint8Array): Promise<void> {}

  async haltClocks(): Promise<{ ok: boolean; reason?: string }> {
    return this.callProducer<{ ok: boolean; reason?: string }>(
      `(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.haltWorld !== 'function') return { ok: false, reason: 'producer missing' };
        p.haltWorld();
        return { ok: true };
      })()`,
    );
  }

  async resumeClocks(): Promise<{ ok: boolean; reason?: string }> {
    return this.callProducer<{ ok: boolean; reason?: string }>(
      `(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.resumeWorld !== 'function') return { ok: false, reason: 'producer missing' };
        p.resumeWorld();
        return { ok: true };
      })()`,
    );
  }

  async emitFrame(_contextId?: number): Promise<{
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

  async getStateSnapshot(contextId: number = 1, opts?: StateSnapshotOpts): Promise<StateSnapshotResult> {
    const single = await this.snapshotContext(contextId, {
      includeTree: opts?.tree === true,
      cssom: opts?.cssom ?? 'none',
    });
    if (!single.ok) return { ok: false, reason: single.reason, contextId };
    const v = single.value!;
    const result: StateSnapshotResult = {
      ok: true,
      contextId,
      generation: v.generation,
      sequence: v.sequence,
      table: opts?.table === 'full' ? { digest: v.table, rows: v.o2 ?? null } : v.table,
      liveChildOrder:
        opts?.liveChildOrder === true
          ? {
              childrenByParent: Array.isArray(
                (v.o2 as unknown as { childrenByParent?: unknown } | null)?.childrenByParent,
              )
                ? (
                    v.o2 as unknown as {
                      childrenByParent: ReadonlyArray<readonly [number, readonly number[]]>;
                    }
                  ).childrenByParent
                : [],
            }
          : null,
      cssom:
        opts?.cssom && opts.cssom !== 'none'
          ? {
              mode: opts.cssom,
              table: { sheets: null, rules: null },
              live: { sheets: v.cssomO2 ?? null },
            }
          : null,
      tree: opts?.tree === true ? (v.tree ?? null) : null,
      formProps: opts?.formProps === true ? (v.formProps ?? []) : null,
      frameNewNodes:
        opts?.frameNewNodes === true && v.nodeNewConnected
          ? v.nodeNewConnected.disconnectedIds.map((nodeId) => ({ nodeId, connected: false }))
          : opts?.frameNewNodes === true
            ? []
            : null,
    };
    return result;
  }


  async snapshotContext(
    contextId: number,
    opts?: {
      includeTree?: boolean;
      cssom?: 'none' | 'committed' | 'scan';
    },
  ): Promise<
    | {
        ok: true;
        value: {
          contextId: number;
          generation: number;
          sequence: number;
          o2: TableLiveOracleResult;
          table: { rowCount: number; tableHash: string };
          cssomO2: CssomTableLiveOracleResult | null;
          nodeNewConnected: {
            ok: boolean;
            checked: number;
            disconnectedIds: number[];
          };
          cascade: {
            authorColor: string;
            adoptedColor: string;
            adoptedCount: number;
            styleSheetCount: number;
            styleElCount: number;
            doublePaint: boolean;
          } | null;
          formProps: FormControlSnap[];
          tree?: unknown;
        };
      }
    | { ok: false; reason: string }
  > {
    try {
      const includeTree = opts?.includeTree !== false;
      const cssom = opts?.cssom ?? 'none';
      const treeScript = includeTree && contextId === 1 ? loadSnapshotScriptForEvaluate() : '';
      const fn = snapshotContextEvaluateExpression();
      return (await this.requirePage().evaluate(
        `(${fn})(${contextId}, ${JSON.stringify({ cssom, includeTree })}, ${JSON.stringify(treeScript)})`,
      )) as Awaited<ReturnType<PageProjectionBrowserSession['snapshotContext']>>;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async startCpuProfile(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.cpuAllowed) return { ok: false, reason: 'cpuProfiling disabled at launch' };
    if (this.cpuRunning) return { ok: false, reason: 'cpu profile already running' };
    const start = this.probes.startCpuProfile;
    if (!start) return { ok: false, reason: 'startCpuProfile probe not registered' };
    const cdp = await this.ensureCdp();
    await start(cdp);
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
    const stop = this.probes.stopCpuProfile;
    if (!stop) return { ok: false, reason: 'stopCpuProfile probe not registered' };
    const cdp = await this.ensureCdp();
    const { raw, summary } = await stop(cdp, 20);
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

  async requestResync(request?: PageProjectionResyncRequest): Promise<void> {
    this.sendControl({
      type: 'requestResync',
      contextId: request?.contextId ?? 1,
      reason: request?.reason,
    });
  }

  async getTelemetrySnapshot(contextId: number = 1): Promise<PageProjectionTelemetrySnapshot> {
    return {
      contextId,
      logicalWidth: this.width,
      logicalHeight: this.height,
      chromeWidth: this.width,
      chromeHeight: this.height,
      dataPlaneListening: !!this.dataPlane.listenUrl,
      generation: this.generation,
      sequence: 0,
      producerHalted: false,
      frameQueueDepth: 0,
      inputPendingCount: 0,
    };
  }

  async getAsset(_key: string, _opts?: unknown): Promise<null> {
    return null;
  }

  async putUpload(_id: string, _body: Uint8Array, _contentType: string, _name: string): Promise<void> {}

  private sendControl(message: Record<string, unknown>): void {
    if (this.dataPlaneMode === 'cdp') {
      const page = this.page;
      if (!page) return;
      void this.cdpPlane.sendControl(page, message);
      return;
    }
    this.dataPlane.sendControl(message);
  }

  private async freshPage(dataPlaneUrl: string, options: BrowserLaunchOptions): Promise<Page> {
    const context = this.context;
    if (!context) throw new Error('context not open');
    const p = await context.newPage();
    p.on('console', (msg) => this.events.onConsole(consoleLevel(msg.type()), msg.text()));
    p.on('pageerror', (err) => this.events.onConsole(3, err.message));
    p.on('framenavigated', (frame) => {
      try {
        if (frame !== p.mainFrame()) return;
        const u = p.url();
        if (!/^https?:\/\//i.test(u) && u !== 'about:blank') return;
        this.url = u;
        this.events.onLocationChanged(u);
      } catch {
        /* */
      }
    });
    p.on('close', () => {
      this.editableFocus.stop();
    });
    const telemetry = (options.projectionTelemetry ?? LAB_TELEMETRY_DEFAULTS) as Partial<ProjectionTelemetryConfig>;
    const useLoopback = this.dataPlaneMode === 'loopback';
    const configPre = buildConfigPreScript({
      transport: useLoopback ? 'loopback' : 'cdp',
      dataPlaneUrl: useLoopback ? dataPlaneUrl : '',
      frameRateHz: options.frameRateHz ?? 60,
      telemetry,
      generation: this.generation,
      cssomPollHz: telemetry.cssomPoll === false ? 0 : 5,
    });
    await p.addInitScript({ content: configPre });
    await p.addInitScript({ content: loadInpageScript() });
    // Document Response-stage hook before any navigation — CSP + optional launch scripts.
    // TLS/HTTP stay on Chromium; never fulfill Document from Node-originated bytes.
    this.cdpSession = await context.newCDPSession(p);
    const launchScripts = options.scripts ?? [];
    const storedScripts = launchScripts
      .filter((s) => !s.remoteUrl && s.file && s.content != null)
      .map((s) => ({ file: s.file, content: s.content }));
    await installDocumentResponseHook(this.cdpSession, {
      mutators: [cspDocumentMutator, createScriptInjectMutator(launchScripts)],
      storedScripts,
    });
    return p;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('PageProjectionBrowserSession: page not open');
    return this.page;
  }

  private requireLaunch(): BrowserLaunchOptions {
    if (!this.launchOpts) throw new Error('PageProjectionBrowserSession: not launched');
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

export function createPageProjectionBrowserSessionFactory(
  opts: PageProjectionFactoryOptions,
): BrowserSessionFactory {
  return {
    create(sessionId, events) {
      return new PageProjectionBrowserSession(sessionId, events, opts) as unknown as import('../../../BrowserSession').BrowserSession;
    },
  };
}

export type { ProjectionTelemetryMessage };
