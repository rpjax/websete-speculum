/**
 * PageProjectionBrowserSession (sealed contract) — Patchright Chromium + in-page producer + owned data plane.
 *
 * Implements sealed IPageProjectionBrowserSession; temporary file path until Live flip (`docs/page-projection/spec/roadmap.md` CUTOVER-SESSION). Replaces
 * Sealed Live path — replace any leftover Patchright video dual path; do not revive DomMap.
 * Must grow to the **full** `BrowserSession` contract (input, cookies, eval, resize,
 * permissions, probes, …) as V4 work, not by preserving legado. Lab-incomplete is not
 * a cutover license.
 */

import { randomUUID } from 'node:crypto';
import { type Browser, type BrowserContext, type CDPSession, type Page } from 'patchright';
import {
  type BrowserDeviceProfile,
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
import { resolveLaunchScripts, buildConfigPayload } from '../inject';
import { ExtensionC2Host, type DocumentInstallEvent } from './extensionC2Host';
import {
  materializeSpeculumPpForSession,
  removeSpeculumPpSessionDir,
  speculumPpExtensionPath,
} from '../../../patchright/ChromeRuntime';
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
import { installDocumentResponseHook, cspDocumentMutator } from './csp/documentResponseHook';
import { cspDiagLog } from './csp/cspDiag';
import {
  abortPrimaryPageReplace,
  beginPrimaryPageReplace,
  commitPrimaryPageReplace,
  installSingleTabAdoption,
} from './singleTab';
import { attachCdpConsoleRelay } from '../../../patchright/cdpConsoleRelay';
import { EditableFocus } from '../../../patchright/EditableFocus';
import { matchesAllowedDomain } from '../../../patchright/Navigation';
import {
  deviceProfilesEqual,
  proveLogicalViewport,
  resolveDeviceProfile,
} from '../../../patchright/device-emulation';
import { validateResizeViewport, type ViewportPolicyBounds } from '../../../patchright/viewport-bounds';
import type { DomInputIngress } from '@speculum/page-projection/core/input/intentTypes';
import type {
  StateSnapshotOpts,
  StateSnapshotResult,
  PageProjectionResyncRequest,
  PageProjectionTelemetrySnapshot,
  StopCpuProfileResult,
} from '../../../contracts';
import { AssetStore } from '../assets/AssetStore';
import { FrameRewriteHop } from '../assets/rewritePart';
import { launchChrome, closeChrome, type ChromeHandle } from '../../../patchright/ChromeRuntime';
import { createInputAdapter } from '../../../input/createInputAdapter';
import type { IInputAdapter } from '../../../input/ports';
import { liveNodeResolveClickDelivery } from '../../../input/clickDelivery';
import { SidecarBuffer } from '../../../input/SidecarBuffer';
import { EventApplier } from '../../../input/EventApplier';
import { ingressToUnifiedIntent } from '../../../input/ingressToUnifiedIntent';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';
import { LaunchBudget, mapBootReasonToErrorCode, resolveLaunchBudgetMs } from './launchBudget';

export type { DocumentInstallEvent };

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
  /**
   * Sparse-cdp PP: no uinput, no Xorg/`Display`. `headless` is Patchright only —
   * headed Chrome uses the native desktop (or ambient host `DISPLAY` if set).
   */
  headless: boolean;
  probes?: PageProjectionProbes;
};

export class PageProjectionBrowserSession {
  private open = false;
  private width = 1280;
  private height = 720;
  private displayWidth = 1280;
  private displayHeight = 720;
  private viewportPolicy: ViewportPolicyBounds | null = null;
  private device: BrowserDeviceProfile = resolveDeviceProfile(null);
  private resizing = false;
  private url = 'about:blank';
  private launchOpts: BrowserLaunchOptions | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private chrome: ChromeHandle | null = null;
  private inputAdapter: IInputAdapter | null = null;
  private eventApplier: EventApplier | null = null;
  private cdpSession: CDPSession | null = null;
  private generation = 0;
  private cpuAllowed = false;
  private cpuRunning = false;
  private readonly headless: boolean;
  private readonly editableFocus: EditableFocus;
  private readonly dataPlane = new ProjectionDataPlaneHost();
  private readonly extensionC2 = new ExtensionC2Host();
  /** Per-session copy of `speculum-pp` (owns c2-endpoint.json). */
  private extensionInstallDir: string | null = null;
  private readonly assets = new AssetStore();
  private readonly rewriteHop = new FrameRewriteHop();
  private readonly probes: PageProjectionProbes;
  private readonly planeBridgeToken: string;
  private launchBudget: LaunchBudget | null = null;
  private readonly installEvents: DocumentInstallEvent[] = [];

  constructor(
    readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
    factoryOpts: PageProjectionFactoryOptions,
  ) {
    this.headless = factoryOpts.headless;
    this.probes = factoryOpts.probes ?? {};
    this.planeBridgeToken = randomUUID();
    this.editableFocus = new EditableFocus(events);
    const onPlane = (channel: number, payload: Uint8Array) => {
      if (channel === PlaneChannel.Frame) {
        const parts = this.rewriteHop.push(payload, {
          pageUrl: this.url,
          assets: this.assets,
        });
        for (const body of parts) {
          const header = peekFrameHeader(body);
          this.events.onPageProjectionFrame?.({
            sequence: header?.sequence ?? 0,
            generation: header?.generation ?? 0,
            plane: '',
            operation: '',
            timestampMs: Date.now(),
            body,
            contextId: header?.contextId ?? 1,
            partIndex: header?.partIndex,
            partCount: header?.partCount,
            flags: header?.flags,
          });
        }
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
    this.extensionC2.setDocumentInstallHandler((evt) => {
      this.installEvents.push(evt);
      this.events.onConsole(
        0,
        `[document.install] gen=${evt.generation} kind=${evt.installKind} url=${evt.url}`,
      );
    });
  }

  /** Lab / diagnostics — document install stream from extension SW. */
  getInstallTelemetry(): {
    installCount: number;
    lastInstallUrl: string | null;
    lastGeneration: number | null;
    events: DocumentInstallEvent[];
  } {
    const last = this.installEvents[this.installEvents.length - 1];
    return {
      installCount: this.installEvents.length,
      lastInstallUrl: last?.url ?? null,
      lastGeneration: last?.generation ?? null,
      events: [...this.installEvents],
    };
  }

  /** Exposed for lab launch probes. */
  get dataPlaneHost(): ProjectionDataPlaneHost {
    return this.dataPlane;
  }

  async launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo> {
    this.launchOpts = options;
    this.width = options.width;
    this.height = options.height;
    this.viewportPolicy = options.viewportPolicy;
    this.device = resolveDeviceProfile(options.device);
    this.cpuAllowed = options.cpuProfiling === true;
    if (options.mirrorMode !== 'pageProjection') {
      throw new Error('PageProjectionBrowserSession requires mirrorMode pageProjection');
    }
    if (options.projectionDataPlane != null && options.projectionDataPlane !== 'loopback') {
      throw Object.assign(
        new Error('PageProjection data plane is loopback-only (projectionDataPlane must be "loopback")'),
        { code: 'FAILED_PRECONDITION', errorCode: 'data_plane_not_loopback', phase: 'launch' },
      );
    }
    if (!process.env['CHROME_EXECUTABLE']?.trim()) {
      throw Object.assign(new Error('CHROME_EXECUTABLE required for PageProjection Chrome launch'), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'chrome_executable_missing',
        phase: 'launch',
      });
    }

    const fs = await import('node:fs');
    const path = await import('node:path');
    const virtualPath = path.join(speculumPpExtensionPath(), 'main', 'virtual.js');
    if (!fs.existsSync(virtualPath)) {
      throw Object.assign(new Error(`speculum-pp virtual.js missing at ${virtualPath}`), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'speculum_pp_virtual_missing',
        phase: 'launch',
      });
    }
    await this.dataPlane.listen();
    this.dataPlane.configureSession(this.sessionId);
    this.extensionInstallDir = materializeSpeculumPpForSession(this.sessionId);
    this.extensionC2.setExtensionDir(this.extensionInstallDir);
    await this.extensionC2.listen();

    // Capacity = policy max R; logical viewport soft-resizes within R (D-UI-05/11).
    // Sparse-cdp is the sole PP input path (OS ABS removed — decision-log.md 2026-08-27).
    // cdp.send is a lazy accessor through currentCdpSession(); safe to build before Chrome exists.
    const maxW = options.viewportPolicy.maxWidth;
    const maxH = options.viewportPolicy.maxHeight;
    this.displayWidth = maxW;
    this.displayHeight = maxH;

    const inputAdapter = createInputAdapter('sparse-cdp', {
      cdp: { send: (method, params) => this.currentCdpSession().send(method as never, params as never) },
      keyboard: {
        down: (key) => this.requirePage().keyboard.down(key),
        up: (key) => this.requirePage().keyboard.up(key),
      },
      logicalWidth: options.width,
      logicalHeight: options.height,
    });
    this.inputAdapter = inputAdapter;

    // No Xorg/`Display` for PP — sparse-cdp only. Headed = native desktop / ambient DISPLAY.
    this.chrome = await launchChrome({
      sessionId: this.sessionId,
      headless: this.headless,
      width: this.width,
      height: this.height,
      locale: options.locale || 'en-US',
      language: options.language || options.locale || 'en-US',
      timeZoneId: options.timeZoneId || 'UTC',
      colorScheme: options.colorScheme === 'no-preference' ? 'light' : options.colorScheme || 'light',
      geolocation: options.geolocation,
      device: options.device,
      extensionPaths: [this.extensionInstallDir],
    });
    this.context = this.chrome.context;
    this.page = this.chrome.page;
    this.cdpSession = this.chrome.cdp;
    this.browser = this.context.browser();
    this.launchBudget = new LaunchBudget(resolveLaunchBudgetMs());
    await this.extensionC2.waitConnected(this.launchBudget.deadlineMs('C2Connect'));

    this.eventApplier = new EventApplier({
      buffer: new SidecarBuffer(),
      pointer: inputAdapter.pointer,
      keyboard: inputAdapter.keyboard,
      activeViewport: () => ({ w: this.width, h: this.height }),
      clickDelivery: liveNodeResolveClickDelivery((contextId, nodeId, localX, localY) =>
        this.resolveClickTarget(contextId, nodeId, localX, localY),
      ),
      applyScrollSet: (args) => this.applyScrollSet(args),
      applyHistoryNav: async (direction) => {
        try {
          if (direction === 'back') await this.goBack();
          else await this.goForward();
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
      onReject: (errorCode, phase) => {
        this.events.onConsole(3, `input_reject ${errorCode} ${phase}`);
      },
    });

    this.context.on('close', () => {
      if (!this.open) return;
      this.open = false;
      this.events.onCrash({
        errorCode: 'browser_disconnected',
        phase: 'runtime',
        message: 'chromium disconnected',
      });
    });
    this.generation = 0;
    this.open = true;
    this.events.onLocationChanged(this.url);
    return { width: this.width, height: this.height };
  }

  async stop(): Promise<void> {
    this.editableFocus.stop();
    this.open = false;
    this.cdpSession = null;
    this.eventApplier = null;
    this.assets.bindPage(null);
    this.assets.clear();
    this.rewriteHop.reset();
    const chrome = this.chrome;
    this.chrome = null;
    this.browser = null;
    this.context = null;
    this.page = null;
    if (chrome) await closeChrome(chrome);
    const inputAdapter = this.inputAdapter;
    this.inputAdapter = null;
    inputAdapter?.dispose();
    await this.dataPlane.close();
    await this.extensionC2.close();
    const extDir = this.extensionInstallDir;
    this.extensionInstallDir = null;
    if (extDir) removeSpeculumPpSessionDir(extDir);
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  async getStatus(): Promise<BrowserStatus> {
    return {
      isOpen: this.open,
      tabCount: this.open ? 1 : 0,
      url: this.url,
      resizing: this.resizing,
      width: this.width,
      height: this.height,
      displayWidth: this.displayWidth,
      displayHeight: this.displayHeight,
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
    // Do not close the live page before freshPage — see freshPage ordering.
    const priorGeneration = this.generation;
    this.cdpSession = null;
    this.dataPlane.configureSession(this.sessionId);
    this.page = await this.freshPage(dataPlaneUrl, opts);
    this.assets.clear();
    this.assets.bindPage(this.page);
    this.rewriteHop.reset();
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
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const budget = this.launchBudget ?? new LaunchBudget();
      await this.dataPlane.waitEstablished({
        afterGeneration: priorGeneration,
        timeoutMs: budget.deadlineMs('HelloEstablish'),
      });
    } catch (err) {
      throw await this.enrichEstablishError(err);
    }
    this.generation = this.dataPlane.establishedGeneration;
    this.url = this.page.url() || url;
    this.events.onLocationChanged(this.url);
    cspDiagLog('navigate complete', {
      url: this.url,
      dataPlaneEstablished: this.dataPlane.isEstablished,
      generation: this.generation,
    });
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
    if (!this.open || !this.viewportPolicy) {
      return {
        ok: false,
        width: this.width,
        height: this.height,
        errorCode: 'session_not_open',
        phase: 'validate',
        message: 'session not open',
      };
    }

    const validated = validateResizeViewport(
      request.width,
      request.height,
      this.viewportPolicy,
    );
    if (!validated.ok) {
      return {
        ok: false,
        width: this.width,
        height: this.height,
        errorCode: validated.errorCode,
        phase: 'validate',
        message: validated.message,
      };
    }

    const nextW = validated.width;
    const nextH = validated.height;
    const nextDevice = resolveDeviceProfile(request.device ?? this.device);

    if (
      nextW === this.width
      && nextH === this.height
      && deviceProfilesEqual(this.device, nextDevice)
      && !this.resizing
    ) {
      return {
        ok: true,
        width: nextW,
        height: nextH,
        chromeWidth: nextW,
        chromeHeight: nextH,
        displayWidth: this.displayWidth,
        displayHeight: this.displayHeight,
      };
    }

    if (this.resizing) {
      return {
        ok: false,
        width: this.width,
        height: this.height,
        errorCode: 'resize_busy',
        phase: 'validate',
        message: 'another resize is in progress',
      };
    }

    this.resizing = true;
    const previous = { width: this.width, height: this.height, device: this.device };
    try {
      // No page yet (launch before first navigate) — store only; prove on first page.
      if (!this.page || !this.context) {
        this.width = nextW;
        this.height = nextH;
        this.device = nextDevice;
        this.inputAdapter?.setLogicalSize(nextW, nextH);
        return {
          ok: true,
          width: nextW,
          height: nextH,
          chromeWidth: nextW,
          chromeHeight: nextH,
          displayWidth: this.displayWidth,
          displayHeight: this.displayHeight,
        };
      }

      const cdp = await this.ensureCdp();
      try {
        const proven = await proveLogicalViewport(cdp, nextW, nextH, nextDevice, {
          phase: 'resize_apply',
          context: this.context,
        });
        this.width = proven.width;
        this.height = proven.height;
        this.device = proven.device;
        this.inputAdapter?.setLogicalSize(this.width, this.height);
      } catch (err) {
        // Soft accept when prove fails on live pages without viewport-meta (same as launch).
        if ((err as { errorCode?: string }).errorCode !== 'viewport_unproven') {
          throw err;
        }
        this.width = nextW;
        this.height = nextH;
        this.device = nextDevice;
        this.inputAdapter?.setLogicalSize(this.width, this.height);
      }
      return {
        ok: true,
        width: this.width,
        height: this.height,
        chromeWidth: this.width,
        chromeHeight: this.height,
        displayWidth: this.displayWidth,
        displayHeight: this.displayHeight,
      };
    } catch (err) {
      this.width = previous.width;
      this.height = previous.height;
      this.device = previous.device;
      this.inputAdapter?.setLogicalSize(previous.width, previous.height);
      try {
        await this.page?.setViewportSize({ width: previous.width, height: previous.height });
      } catch {
        /* best-effort rollback */
      }
      const code = (err as { errorCode?: string }).errorCode ?? 'resize_failed';
      const phase = (err as { phase?: string }).phase ?? 'resize_apply';
      return {
        ok: false,
        width: this.width,
        height: this.height,
        errorCode: code,
        phase,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.resizing = false;
    }
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
      // Patchright isolated world — DOM OK; Virtual producer globals are NOT visible here.
      // Producer RPC = loopback invoke (§10.1c), not CDP Runtime.evaluate.
      const page = this.requirePage();
      const value = await page.evaluate(code);
      return { ok: true, value: typeof value === 'string' ? value : JSON.stringify(value) };
    } catch (err) {
      return { ok: false, value: '', errorMessage: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Virtual expression in root or nested iframe context (loopback). Lab probes only. */
  async evaluateVirtualExpression(code: string, contextId = CONTEXT_ID_ROOT): Promise<unknown> {
    if (contextId === CONTEXT_ID_ROOT) {
      const r = await this.evaluate(code);
      return r.ok ? r.value : null;
    }
    const r = await this.loopbackInvoke<{ ok?: boolean; value?: unknown; reason?: string }>(
      'evaluateInContext',
      { contextId, expression: code },
    );
    return r.ok ? r.value : null;
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
    if (!this.eventApplier) {
      throw Object.assign(new Error('PageProjection EventApplier not ready'), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'input_applier_missing',
        phase: 'input',
      });
    }
    const intent = ingressToUnifiedIntent(input);
    if (!intent) {
      return { status: 'dropped', reason: 'unsupported_intent' };
    }
    this.eventApplier.enqueue(intent);
    return { status: 'dispatched' };
  }

  getInputPipelineMetrics(): null {
    return null;
  }

  /** Lab/dossier label — sparse-cdp is the sole PP input path. */
  getInputBackend(): 'cdp' {
    return 'cdp';
  }

  /**
   * Lab/CLI blueprint helper — id-addressed click via Virtual `resolveNodeHit`.
   * Enqueues onto the same `EventApplier` as `pushInput`.
   */
  async resolveAndClickDomInputByNodeId(
    selector: string,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    if (!this.eventApplier) {
      return { status: 'dropped', reason: 'input_applier_missing' };
    }
    const keyed = await this.loopbackInvoke<{ ok?: boolean; reason?: string; nodeId?: number }>(
      'keyOfSelector',
      { selector, contextId },
    );
    if (!keyed.ok || typeof keyed.nodeId !== 'number' || keyed.nodeId <= 0) {
      return { status: 'dropped', reason: keyed.reason ?? 'selector_miss' };
    }
    const hit = await this.loopbackInvoke<{ ok?: boolean; reason?: string; x?: number; y?: number }>(
      'resolveNodeHit',
      { contextId, nodeId: keyed.nodeId },
    );
    if (!hit.ok || typeof hit.x !== 'number' || typeof hit.y !== 'number') {
      return { status: 'dropped', reason: hit.reason ?? 'resolve_hit_failed' };
    }
    const base = {
      schemaVersion: 1 as const,
      viewportW: this.width,
      viewportH: this.height,
      x: hit.x,
      y: hit.y,
      localX: 0.5,
      localY: 0.5,
      button: 'left' as const,
      contextId,
      nodeId: keyed.nodeId,
    };
    this.eventApplier.enqueue({ ...base, type: 'down' });
    this.eventApplier.enqueue({ ...base, type: 'up' });
    await this.eventApplier.flush();
    return { status: 'dispatched' };
  }

  /** @deprecated Alias — blueprints historically called resolveAndClickDomInput; now id-addressed. */
  async resolveAndClickDomInput(
    selector: string,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    return this.resolveAndClickDomInputByNodeId(selector, contextId);
  }

  async resolveAndTypeDomInput(
    selector: string,
    value: string,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    const click = await this.resolveAndClickDomInputByNodeId(selector, contextId);
    if (click.status !== 'dispatched' || !this.eventApplier) return click;
    await new Promise((r) => setTimeout(r, 80));
    for (const ch of value) {
      this.eventApplier.enqueue({
        schemaVersion: 1,
        type: 'keyDown',
        key: ch,
        code: ch,
      });
      this.eventApplier.enqueue({
        schemaVersion: 1,
        type: 'keyUp',
        key: ch,
        code: ch,
      });
    }
    await this.eventApplier.flush();
    return { status: 'dispatched' };
  }

  async resolveAndScrollElementDomInput(
    selector: string,
    scrollTop: number,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    if (!this.eventApplier) {
      return { status: 'dropped', reason: 'input_applier_missing' };
    }
    const keyed = await this.loopbackInvoke<{ ok?: boolean; reason?: string; nodeId?: number }>(
      'keyOfSelector',
      { selector, contextId },
    );
    if (!keyed.ok || typeof keyed.nodeId !== 'number' || keyed.nodeId <= 0) {
      return { status: 'dropped', reason: keyed.reason ?? 'selector_miss' };
    }
    this.eventApplier.enqueue({
      schemaVersion: 1,
      type: 'scrollSet',
      contextId,
      nodeId: keyed.nodeId,
      scrollX: 0,
      scrollY: scrollTop,
    });
    await this.eventApplier.flush();
    return { status: 'dispatched' };
  }

  async resolveAndScrollViewportDomInput(
    scrollY: number,
    scrollX: number = 0,
    contextId: number = 1,
  ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    if (!this.eventApplier) {
      return { status: 'dropped', reason: 'input_applier_missing' };
    }
    this.eventApplier.enqueue({
      schemaVersion: 1,
      type: 'scrollSet',
      contextId,
      nodeId: null,
      scrollX,
      scrollY,
    });
    await this.eventApplier.flush();
    return { status: 'dispatched' };
  }

  private async resolveClickTarget(
    contextId: number,
    nodeId: number,
    localX: number | undefined,
    localY: number | undefined,
  ): Promise<{ ok: boolean; x?: number; y?: number; reason?: string }> {
    const r = await this.loopbackInvoke<{ ok?: boolean; reason?: string; x?: number; y?: number }>(
      'resolveNodeHit',
      { contextId, nodeId, localX, localY },
    );
    if (!r.ok || typeof r.x !== 'number' || typeof r.y !== 'number') {
      return { ok: false, reason: r.reason ?? 'node_not_found' };
    }
    return { ok: true, x: r.x, y: r.y };
  }

  private async applyScrollSet(args: {
    contextId: number;
    nodeId: number | null;
    scrollX: number;
    scrollY: number;
  }): Promise<{ ok: boolean; error?: string }> {
    const r = await this.loopbackInvoke<{ ok?: boolean; reason?: string }>('applyScrollSet', args);
    if (!r.ok) return { ok: false, error: r.reason ?? 'apply_scroll_failed' };
    return { ok: true };
  }

  /**
   * Lab/diag — timed direct loopback `applyScrollSet` (bypasses EventApplier queue).
   * Pair with `SPECULUM_DIAG_LOOPBACK=1` + `drainInvokeDiagTraces()` for heartbeat evidence.
   */
  async measureApplyScrollSet(args: {
    contextId: number;
    nodeId: number | null;
    scrollX: number;
    scrollY: number;
  }): Promise<{ ok: boolean; error?: string; wallMs: number }> {
    const t0 = performance.now();
    const r = await this.applyScrollSet(args);
    return { ...r, wallMs: performance.now() - t0 };
  }

  /** Lab/unit oracle — Node↔Virtual loopback establish symmetry (loopback.md §14). */
  async probeLoopbackStatus(): Promise<{
    nodeEstablished: boolean;
    virtualEstablished: boolean;
    generation: number;
  }> {
    const nodeEstablished = this.dataPlane.isEstablished;
    let virtualEstablished = false;
    // Patchright page.evaluate often cannot see MAIN-world Virtual globals. Prefer CDP
    // Runtime.evaluate; after hard nav the default context can lag, so fall back to a
    // loopback RPC that only succeeds when Virtual is established.
    const cdp = this.cdpSession;
    if (cdp) {
      try {
        const result = await cdp.send('Runtime.evaluate', {
          expression:
            '!!(globalThis.__speculumProjection && globalThis.__speculumProjection.frameTransport && globalThis.__speculumProjection.frameTransport.isEstablished)',
          returnByValue: true,
        });
        virtualEstablished = result?.result?.value === true;
      } catch {
        virtualEstablished = false;
      }
    }
    if (!virtualEstablished && nodeEstablished) {
      try {
        const r = await this.dataPlane.invoke('keyOfSelector', {
          selector: 'html',
          contextId: 1,
        });
        virtualEstablished = r.ok === true;
      } catch {
        virtualEstablished = false;
      }
    }
    if (nodeEstablished && this.dataPlane.establishedGeneration > this.generation) {
      this.generation = this.dataPlane.establishedGeneration;
    }
    return {
      nodeEstablished,
      virtualEstablished,
      generation: this.generation,
    };
  }

  async pushCameraFrame(_frame: Uint8Array): Promise<void> {}
  async pushMicrophoneAudio(_chunk: Uint8Array): Promise<void> {}

  async haltClocks(): Promise<{ ok: boolean; reason?: string }> {
    return this.loopbackInvoke('haltWorld', {});
  }

  async resumeClocks(): Promise<{ ok: boolean; reason?: string }> {
    return this.loopbackInvoke('resumeWorld', {});
  }

  async emitFrame(_contextId?: number): Promise<{
    ok: boolean;
    generation?: number;
    sequence?: number;
    reason?: string;
  }> {
    return this.loopbackInvoke('flushFrame', {});
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
      const r = await this.dataPlane.invoke('snapshotContext', {
        contextId,
        includeTree,
        cssom,
      });
      if (!r.ok) {
        return { ok: false, reason: r.error?.message ?? 'snapshot_invoke_failed' };
      }
      const payload = r.value as
        | { ok: true; value: unknown }
        | { ok: false; reason?: string }
        | null;
      if (!payload || typeof payload !== 'object') {
        return { ok: false, reason: 'snapshot_empty' };
      }
      if (payload.ok === false) {
        return { ok: false, reason: payload.reason ?? 'snapshot_failed' };
      }
      if (payload.ok === true && 'value' in payload) {
        return {
          ok: true,
          value: payload.value as Extract<
            Awaited<ReturnType<PageProjectionBrowserSession['snapshotContext']>>,
            { ok: true }
          >['value'],
        };
      }
      return { ok: false, reason: 'snapshot_shape' };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Lab diag — geometry probe routed to a Virtual context via loopback. */
  async measureNodeRect(
    contextId: number,
    nodeId: number,
  ): Promise<{
    ok: boolean;
    reason?: string;
    tagName?: string;
    rect?: { x: number; y: number; width: number; height: number };
    offsetWidth?: number;
    offsetHeight?: number;
    display?: string | null;
    visibility?: string | null;
    hasSrcAttr?: boolean;
    src?: string | null;
  }> {
    try {
      const r = await this.dataPlane.invoke('measureNodeRect', { contextId, nodeId });
      if (!r.ok) {
        return { ok: false, reason: r.error?.message ?? 'measure_invoke_failed' };
      }
      const payload = r.value as { ok: boolean; reason?: string } & Record<string, unknown>;
      if (!payload || typeof payload !== 'object') {
        return { ok: false, reason: 'measure_empty' };
      }
      return payload as Awaited<ReturnType<PageProjectionBrowserSession['measureNodeRect']>>;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Lab diag — root Virtual Turnstile iframe chain (pierces closed shadow). */
  async measureTurnstileRootRects(): Promise<{
    ok: boolean;
    reason?: string;
    levels?: Array<{
      name: string;
      ok: boolean;
      reason?: string;
      tagName?: string;
      rect?: { x: number; y: number; width: number; height: number };
      offsetWidth?: number;
      offsetHeight?: number;
      display?: string | null;
      visibility?: string | null;
      hasSrcAttr?: boolean | null;
      src?: string | null;
    }>;
  }> {
    try {
      const r = await this.dataPlane.invoke('measureTurnstileRootRects', { contextId: 1 });
      if (!r.ok) {
        return { ok: false, reason: r.error?.message ?? 'measure_invoke_failed' };
      }
      const payload = r.value as { ok: boolean; reason?: string; levels?: unknown[] };
      if (!payload || typeof payload !== 'object') {
        return { ok: false, reason: 'measure_empty' };
      }
      return payload as Awaited<ReturnType<PageProjectionBrowserSession['measureTurnstileRootRects']>>;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async measureNodePaint(
    contextId: number,
    nodeId: number,
  ): Promise<{
    ok: boolean;
    reason?: string;
    paint?: {
      backgroundColor: string;
      color: string;
      opacity: string;
      visibility: string;
      display: string;
      borderTopWidth: string;
      borderTopColor: string;
      borderTopStyle: string;
      width: string;
      height: string;
    };
  }> {
    try {
      const r = await this.dataPlane.invoke('measureNodePaint', { contextId, nodeId });
      if (!r.ok) {
        return { ok: false, reason: r.error?.message ?? 'paint_invoke_failed' };
      }
      const payload = r.value as { ok: boolean; reason?: string; paint?: unknown };
      if (!payload || typeof payload !== 'object') {
        return { ok: false, reason: 'paint_empty' };
      }
      return payload as Awaited<ReturnType<PageProjectionBrowserSession['measureNodePaint']>>;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Lab diag — CDP viewport clip PNG (K1 diag only). */
  async captureViewportClip(clip: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<{ ok: boolean; base64?: string; reason?: string; byteLength?: number }> {
    try {
      const cdp = await this.ensureCdp();
      const result = (await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: Math.max(0, clip.x),
          y: Math.max(0, clip.y),
          width: Math.max(1, clip.width),
          height: Math.max(1, clip.height),
          scale: 1,
        },
      })) as { data?: string };
      if (typeof result.data !== 'string' || result.data.length === 0) {
        return { ok: false, reason: 'empty_screenshot' };
      }
      return { ok: true, base64: result.data, byteLength: result.data.length };
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

  async getAsset(
    key: string,
    opts?: { kind?: string; rangeHeader?: string },
  ): Promise<{
    body: Uint8Array;
    contentType: string;
    statusCode?: number;
    contentRange?: string;
    passThrough?: boolean;
    requestHadCookie?: boolean;
    requestHadAuthorization?: boolean;
    cacheControl?: string;
    vary?: string;
  } | null> {
    return this.assets.getAsset(key, opts);
  }

  /** gRPC / BrowserSession alias — same L1 as {@link getAsset}. */
  async getDomAsset(
    key: string,
    opts?: { kind?: string; rangeHeader?: string },
  ): Promise<{
    body: Uint8Array;
    contentType: string;
    statusCode?: number;
    contentRange?: string;
    passThrough?: boolean;
    requestHadCookie?: boolean;
    requestHadAuthorization?: boolean;
    cacheControl?: string;
    vary?: string;
  } | null> {
    return this.getAsset(key, opts);
  }

  async putUpload(_id: string, _body: Uint8Array, _contentType: string, _name: string): Promise<void> {}

  async putDomUpload(id: string, body: Uint8Array, contentType: string, name: string): Promise<void> {
    return this.putUpload(id, body, contentType, name);
  }

  private sendControl(message: Record<string, unknown>): void {
    this.dataPlane.sendControl(message);
  }

  /** Live lookup for `sparse-cdp` — `this.cdpSession` is reassigned on every `freshPage()`. */
  private currentCdpSession(): CDPSession {
    if (!this.cdpSession) {
      throw Object.assign(new Error('no active CDP session for sparse-cdp input adapter'), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'cdp_session_unavailable',
        phase: 'input',
      });
    }
    return this.cdpSession;
  }

  private async freshPage(dataPlaneUrl: string, options: BrowserLaunchOptions): Promise<Page> {
    const context = this.context;
    if (!context) throw new Error('context not open');
    // Create the replacement tab BEFORE closing the old one. After CDP
    // Extensions.loadUnpacked, Chrome 152 can fail Target.createTarget when no
    // page target remains (session navigate used to close-then-open).
    // Suspend single-tab orphan closer: it would otherwise close this new page
    // as a "second tab", then we close the old primary → zero pages → context die.
    beginPrimaryPageReplace(context);
    let p: Page;
    try {
      p = await context.newPage();
      const stale = context.pages().filter((x) => x !== p);
      for (const old of stale) {
        try {
          await old.close();
        } catch {
          /* best-effort */
        }
      }
    } catch (err) {
      abortPrimaryPageReplace(context);
      throw err;
    }
    p.on('crash', () => {
      if (!this.open) return;
      this.open = false;
      this.events.onCrash({
        errorCode: 'page_crash',
        phase: 'runtime',
        message: 'chromium page crashed',
      });
    });
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
    this.cdpSession = await context.newCDPSession(p);
    // Patchright page.on('console') / pageerror are silent — CDP Runtime is the relay.
    await attachCdpConsoleRelay(this.cdpSession, (level, text) => this.events.onConsole(level, text));
    // Launch scripts: gate lives in SessionConfig for the extension entry (customs in V1 via
    // TargetRules in the content-script entry when wired). Resolved here so C2 carries knobs.
    void (await resolveLaunchScripts(options.scripts ?? []));
    const sessionConfig = buildConfigPayload({
      sessionId: this.sessionId,
      transport: 'loopback',
      dataPlaneUrl,
      loopbackCarrier: 'extension',
      planeBridgeToken: this.planeBridgeToken,
      frameRateHz: options.frameRateHz ?? 60,
      telemetry,
      cssomPollHz: telemetry.cssomPoll === false ? 0 : 5,
    });
    // ACK before any navigation — fail-closed (runtime-redesign.md §0 #3).
    const budget = this.launchBudget ?? new LaunchBudget();
    await this.extensionC2.pushSessionConfig(
      sessionConfig as import('./extensionC2Host').ExtensionSessionConfig,
      budget.deadlineMs('SessionAck'),
    );
    await installDocumentResponseHook(this.cdpSession, {
      mutators: [cspDocumentMutator],
      context,
      page: p,
    });
    // Locale / OAuth popups → same tab so CSP surgery + data plane stay on the primary page.
    const adoptUrlOnPrimary = async (url: string) => {
      const allowed = options.allowedNavigationDomains;
      if (allowed && allowed.length > 0) {
        try {
          const host = new URL(url).hostname;
          if (!matchesAllowedDomain(host, allowed)) {
            this.events.onMainFrameNavigationBlocked(url);
            return;
          }
        } catch {
          return;
        }
      }
      const prior = this.generation;
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const navBudget = this.launchBudget ?? new LaunchBudget();
      await this.dataPlane.waitEstablished({
        afterGeneration: prior,
        timeoutMs: navBudget.deadlineMs('HelloEstablish'),
      });
      this.generation = this.dataPlane.establishedGeneration;
      this.url = p.url() || url;
      this.events.onLocationChanged(this.url);
      this.editableFocus.rebind(p);
    };
    installSingleTabAdoption({
      page: p,
      context,
      adoptUrlOnPrimary,
    });
    commitPrimaryPageReplace(context, p, adoptUrlOnPrimary);
    // Lockstep prove — same as video launch/resize (Q14 / PP-SURF-5).
    try {
      await proveLogicalViewport(this.cdpSession, this.width, this.height, this.device, {
        phase: 'launch_apply',
        context,
      });
    } catch (err) {
      // Soft: context viewport already set; prove can fail on about:blank before meta.
      // Resize path re-proves with full error surface.
      if ((err as { errorCode?: string }).errorCode === 'viewport_unproven') {
        /* continue — first paint pages install meta */
      } else {
        throw err;
      }
    }
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

  /** Sidecar → Virtual domain RPC via loopback mux (not CDP). */
  private async loopbackInvoke<T extends { ok?: boolean; reason?: string }>(
    name: string,
    args: unknown,
  ): Promise<T> {
    const r = await this.dataPlane.invoke(name, args);
    if (!r.ok) {
      return { ok: false, reason: r.error?.message ?? 'invoke_failed' } as T;
    }
    const value = r.value as T | undefined;
    if (value && typeof value === 'object' && 'ok' in value && value.ok === false) {
      return value;
    }
    if (value && typeof value === 'object') {
      return { ok: true, ...value } as T;
    }
    return { ok: true } as T;
  }

  private async enrichEstablishError(err: unknown): Promise<Error> {
    const base = err instanceof Error ? err : new Error(String(err));
    const bag = base as Error & {
      errorCode?: string;
      phase?: string;
      lastBootReason?: string;
      lastHelloReject?: string;
      documentUrl?: string;
      installGeneration?: number;
      installCount?: number;
      installTimeline?: DocumentInstallEvent[];
    };
    const establishCodes = new Set(['data_plane_not_established', 'establish_timeout']);
    if (!establishCodes.has(bag.errorCode ?? '') && bag.phase !== 'establish') {
      return base;
    }
    bag.phase = 'establish';
    bag.errorCode = bag.errorCode ?? 'establish_timeout';
    bag.installGeneration = this.dataPlane.establishedGeneration;
    bag.documentUrl = this.page?.url() ?? this.url;
    const status = this.dataPlane.dataPlane.status;
    if (status.lastError?.code) bag.lastHelloReject = status.lastError.code;
    try {
      const raw = await this.evaluate('JSON.stringify(globalThis.__speculumBootOutcome ?? null)');
      if (raw.ok && typeof raw.value === 'string') {
        const outcome = JSON.parse(raw.value) as { reason?: string; ok?: boolean };
        if (outcome.reason) {
          bag.lastBootReason = outcome.reason;
          if (!outcome.ok) {
            bag.errorCode = mapBootReasonToErrorCode(outcome.reason);
            bag.phase = 'boot';
          }
        }
      }
    } catch {
      /* ignore boot outcome read */
    }
    const tel = this.getInstallTelemetry();
    bag.installCount = tel.installCount;
    bag.installTimeline = tel.events;
    return base;
  }
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
