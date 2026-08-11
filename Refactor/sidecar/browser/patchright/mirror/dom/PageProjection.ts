import { createHash, randomUUID } from 'node:crypto';
import type { Page, CDPSession, Frame, ElementHandle } from 'patchright';
import {
  DomAssetCache,
  isPassThroughUrl,
  virtualAssetKeyFromUrl,
} from './DomAssetCache';
import {
  PAGE_PROJECTION_PAGE_SCRIPT,
  encodeDomBody,
  type PageProjectionDiffEmit,
  type PageProjectionEmitPayload,
  type DomNodeJson,
} from './DomTreeSerializer';
import { mapSrcset, parseSrcset } from './srcsetParse';
import { countNodesApprox, summarizeSheets, urlKeyOf } from './parityUtil';
import { VirtualEpochTelemetry } from './VirtualEpochTelemetry';

/** In-page DomMap phase timings (Date.now in the page) — excludes CDP transfer. */
export type DomMapPhaseTimings = {
  takeRecordsMs?: number;
  clearLedgerMs?: number;
  anchorAllMs?: number;
  remintMs?: number;
  mapNodeMs?: number;
  resetPublishedMs?: number;
  cssomMs?: number;
  /** In-page JSON.stringify of root (/sheets) before CDP return. */
  stringifyMs?: number;
  pageTotalMs?: number;
};

/** Result of `__speculumDomMap*` after Node-side JSON.parse of scalar wire strings. */
type ParsedDomMapEvaluate = {
  generation?: number;
  root: DomNodeJson | null;
  sheets?: unknown[];
  timings?: DomMapPhaseTimings;
};

export type PageProjectionEvents = {
  onPageProjectionDiff(diff: PageProjectionDiffEmit): void;
  onGenerationBumped?(event: {
    fromGeneration: number;
    toGeneration: number;
    reason: 'main_frame_navigated' | 'page_emit_sync';
    url?: string;
    diffKind?: string;
  }): void;
  onSoftNavObserved?(event: {
    generation: number;
    url?: string;
    documentEpoch?: string;
    liveArmed: boolean;
  }): void;
  onScrollEchoHit?(event: {
    kind: 'viewport' | 'element';
    generation?: number;
    anchor?: string;
    scrollX?: number;
    scrollY?: number;
    scrollTop?: number;
    scrollLeft?: number;
  }): void;
  /** PageEpoch parity telemetry (Virtual / Establish / Asset / Resync `parity_*` kinds). */
  onParity?(kind: string, payload: Record<string, unknown>): void;
};

/** goto | reload | back_forward | soft | unknown — set via {@link PageProjection.notePendingNavigation}. */
export type PageProjectionNavigationType = 'goto' | 'reload' | 'back_forward' | 'soft' | 'unknown';

const MAX_ASSET_FETCHES_PER_DIFF = 64;
const VIRTUAL_ASSETS_PREFIX = '/w7s/virtual-assets/';
const VIRTUAL_BLOB_PREFIX = '/w7s/virtual-blob/';
const VIRTUAL_DATA_PREFIX = '/w7s/virtual-data/';

/**
 * PageProjection producer: observe → anchor → map → rewrite → emit.
 * Owns the shared Dom/Cssom `sequence`; restarts it on every generation bump.
 */
export class PageProjection {
  private sequence = 0;
  private sequenceGeneration = 1;
  private generation = 1;
  private documentEpoch: string | null = null;
  /** False until first Dom/Cssom establish after the session's initial Document is ready (D4). */
  private established = false;
  /**
   * Sidecar gate for page live emits. Armed after stream seed Dom `document` +
   * Cssom `install` have been materializeAndPush'd on this epoch (observation on).
   */
  private liveArmed = false;
  private establishInFlight: Promise<void> | null = null;
  private stopped = false;
  private readonly assets = new DomAssetCache();
  private materializeChain: Promise<void> = Promise.resolve();
  private readonly uploads = new Map<string, { body: Buffer; contentType: string; name: string }>();
  /** CDP session for closed-shadow pierce (T7) — declarative / pre-hook roots. */
  private cdp: CDPSession | null = null;
  /** Main-frame CDP id — used to ignore Page.navigatedWithinDocument soft navs (D4). */
  private mainFrameCdpId: string | null = null;
  /** Epoch observed on within-document navigation — never bump while it matches (D4). */
  private softNavEpoch: string | null = null;
  /** Host iframe anchor → Chromium child frame (XO pierce). */
  private readonly chromiumPierceByAnchor = new Map<string, Frame>();
  private readonly chromiumPierceByFrame = new WeakMap<Frame, string>();
  /** C7: Cssom sheet ids published for each XO pierce host (teardown on swap/kill). */
  private readonly chromiumPierceSheetIds = new Map<string, Set<string>>();
  private chromiumPierceChain: Promise<void> = Promise.resolve();
  /**
   * Install-ready Cssom mirror updated on every live cssom materialize.
   * OOB resync clones this instead of re-walking Virtual cssRules (C8).
   */
  private readonly cssomInstallById = new Map<string, CssomMirrorSheet>();
  /**
   * Install-ready Dom mirror updated after every successful Dom materialize+push.
   * OOB / resume clones this instead of remapping Virtual (DomMap ms path).
   * Fail-safe: any apply miss invalidates → next OOB remaps from the page.
   */
  private domInstallRoot: DomNodeJson | null = null;

  /** PageEpoch parity telemetry (Virtual / Establish / Asset / Resync `parity_*` kinds). */
  private pageEpochId: string | null = null;
  private browserLaunchedAtMs = Date.now();
  private commitAtMs: number | null = null;
  private bootMarked = false;
  private pendingNavigationType: PageProjectionNavigationType | null = null;
  private firstDiffEmittedForEpoch = false;
  private lastSeededSheetCount = 0;
  private virtualTelemetry: VirtualEpochTelemetry | null = null;

  private constructor(
    private readonly page: Page,
    private readonly events: PageProjectionEvents,
  ) {}

  static async start(
    page: Page,
    events: PageProjectionEvents,
    opts?: { browserLaunchedAtMs?: number },
  ): Promise<PageProjection> {
    const proj = new PageProjection(page, events);
    if (typeof opts?.browserLaunchedAtMs === 'number') {
      proj.browserLaunchedAtMs = opts.browserLaunchedAtMs;
    }
    await page.exposeBinding('__speculumDomEmit', (_source: unknown, payload: unknown) => {
      if (proj.stopped) return;
      proj.emitFromPage(payload);
    });
    await page.exposeBinding(
      '__speculumDomScrollEchoHit',
      (_source: unknown, info: unknown) => {
        if (proj.stopped || !info || typeof info !== 'object') return;
        const o = info as Record<string, unknown>;
        const kind = o.kind === 'element' ? 'element' : o.kind === 'viewport' ? 'viewport' : null;
        if (!kind) return;
        proj.events.onScrollEchoHit?.({
          kind,
          generation: proj.generation,
          anchor: typeof o.anchor === 'string' ? o.anchor : undefined,
          scrollX: typeof o.scrollX === 'number' ? o.scrollX : undefined,
          scrollY: typeof o.scrollY === 'number' ? o.scrollY : undefined,
          scrollTop: typeof o.scrollTop === 'number' ? o.scrollTop : undefined,
          scrollLeft: typeof o.scrollLeft === 'number' ? o.scrollLeft : undefined,
        });
      },
    );
    await page.exposeBinding(
      '__speculumDomRequestChromiumIframePierce',
      (_source: unknown, anchor: unknown) => {
        if (proj.stopped || typeof anchor !== 'string' || !anchor) return;
        void proj.enqueueChromiumIframePierce(anchor);
      },
    );
    await page.exposeBinding(
      '__speculumDomChromiumIframePublish',
      async (_source: unknown, anchor: unknown, root: unknown, sheets: unknown) => {
        if (proj.stopped || typeof anchor !== 'string' || !anchor) return;
        await proj.applyChromiumIframePublish(anchor, root, sheets);
      },
    );
    await page.exposeBinding(
      '__speculumDomChromiumIframeTeardown',
      (_source: unknown, anchor: unknown) => {
        if (proj.stopped || typeof anchor !== 'string' || !anchor) return;
        void proj.teardownChromiumIframeCssom(anchor);
      },
    );
    await page.addInitScript({ content: PAGE_PROJECTION_PAGE_SCRIPT });
    await page.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);
    await proj.ensureClosedShadowPierce();
    // Install observers; stream establish (seed+arm) runs from establishBoot / hard nav
    // as early as commit — not a post-settle full DomMap.
    page.on('framenavigated', (frame) => {
      if (proj.stopped) return;
      if (frame === page.mainFrame()) {
        void proj.onMainFrameNavigated();
        return;
      }
      void proj.onChildFrameNavigated(frame);
    });
    return proj;
  }

  /**
   * Recorded by the caller (navigate / refresh / history nav) just before it triggers
   * the browser navigation, so the NavCommit that follows (via framenavigated, which may
   * race the caller's own await) can still attribute the correct navigationType.
   */
  notePendingNavigation(kind: PageProjectionNavigationType): void {
    this.pendingNavigationType = kind;
  }

  private emitParity(kind: string, payload: Record<string, unknown>): void {
    this.events.onParity?.(kind, payload);
  }

  /** Build DomMapCompleted parity payload: in-page phases + CDP transfer gap. */
  private domMapCompletedPayload(args: {
    pageEpochId: string;
    generation: number;
    path: 'establish' | 'resync';
    evaluateWallMs: number;
    approxNodes?: number;
    timings?: DomMapPhaseTimings;
    /** True when Dom came from `domInstallRoot` clone (no page.evaluate map). */
    mirror?: boolean;
  }): Record<string, unknown> {
    const t = args.timings ?? {};
    const pageTotalMs = Math.max(0, Number(t.pageTotalMs ?? 0) || 0);
    const evaluateWallMs = Math.max(0, args.evaluateWallMs);
    const cdpTransferMs = Math.max(0, evaluateWallMs - pageTotalMs);
    return {
      pageEpochId: args.pageEpochId,
      generation: args.generation,
      path: args.path,
      durationMs: evaluateWallMs,
      approxNodes: args.approxNodes,
      takeRecordsMs: Math.max(0, Number(t.takeRecordsMs ?? 0) || 0),
      clearLedgerMs: Math.max(0, Number(t.clearLedgerMs ?? 0) || 0),
      anchorAllMs: Math.max(0, Number(t.anchorAllMs ?? 0) || 0),
      remintMs: Math.max(0, Number(t.remintMs ?? 0) || 0),
      mapNodeMs: Math.max(0, Number(t.mapNodeMs ?? 0) || 0),
      resetPublishedMs: Math.max(0, Number(t.resetPublishedMs ?? 0) || 0),
      cssomMs: Math.max(0, Number(t.cssomMs ?? 0) || 0),
      pageTotalMs,
      cdpTransferMs,
      mirror: !!args.mirror,
      tVirtualMs: this.tVirtualMs(),
    };
  }

  /** Elapsed ms since browser launch — shared timeline across every parity event. */
  private tVirtualMs(): number {
    return Date.now() - this.browserLaunchedAtMs;
  }

  private tSinceCommitMs(): number | undefined {
    return this.commitAtMs != null ? Date.now() - this.commitAtMs : undefined;
  }

  /** SoftNav SPA wipe — new pageEpochId, same generation. */
  private onSoftNavCommit(url?: string, documentEpoch?: string): void {
    const now = Date.now();
    this.pageEpochId = randomUUID();
    this.commitAtMs = now;
    this.firstDiffEmittedForEpoch = false;
    this.emitParity('parity_virtual_nav_commit', {
      pageEpochId: this.pageEpochId,
      url: url ?? safePageUrl(this.page),
      generation: this.generation,
      documentEpoch: documentEpoch ?? this.documentEpoch ?? undefined,
      navigationType: 'soft',
      tVirtualMs: this.tVirtualMs(),
    });
    this.restartVirtualTelemetry();
  }

  private restartVirtualTelemetry(): void {
    if (!this.pageEpochId || this.commitAtMs == null) return;
    this.virtualTelemetry?.stop();
    this.virtualTelemetry = new VirtualEpochTelemetry(
      this.page,
      this.pageEpochId,
      this.commitAtMs,
      (kind, payload) => this.emitParity(kind, payload),
      () => this.tVirtualMs(),
    );
    this.virtualTelemetry.start();
  }

  /** New Document committed for this session (real navigation, not soft-nav). */
  private onNavCommit(): void {
    const now = Date.now();
    const isFirstCommit = this.commitAtMs === null;
    this.pageEpochId = randomUUID();
    this.commitAtMs = now;
    this.firstDiffEmittedForEpoch = false;
    const navigationType = this.pendingNavigationType ?? 'unknown';
    this.pendingNavigationType = null;
    this.emitParity('parity_virtual_nav_commit', {
      pageEpochId: this.pageEpochId,
      url: safePageUrl(this.page),
      generation: this.generation,
      documentEpoch: this.documentEpoch ?? undefined,
      navigationType,
      tVirtualMs: this.tVirtualMs(),
    });
    if (isFirstCommit && !this.bootMarked) {
      this.bootMarked = true;
      this.emitParity('parity_virtual_boot_marked', {
        pageEpochId: this.pageEpochId,
        browserLaunchedAtMs: this.browserLaunchedAtMs,
        firstCommitAtMs: now,
        bootMs: now - this.browserLaunchedAtMs,
      });
    }
    this.restartVirtualTelemetry();
  }

  /**
   * First stream seed (Dom document + Cssom install) for the session.
   * Idempotent — safe from navigate-at-commit and from late framenavigated.
   */
  async establishBoot(): Promise<void> {
    if (this.stopped || this.established) return;
    if (this.establishInFlight) {
      await this.establishInFlight;
      return;
    }
    this.establishInFlight = this.doEstablishBoot();
    try {
      await this.establishInFlight;
    } finally {
      this.establishInFlight = null;
    }
  }

  private async doEstablishBoot(): Promise<void> {
    if (this.stopped || this.established) return;
    try {
      await this.page.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);
      const epoch = await this.readDocumentEpoch();
      if (epoch === null) return;
      if (this.isBlankDocumentUrl(this.page.url())) return;
      this.documentEpoch = epoch;
      this.generation = 1;
      this.sequence = 0;
      this.sequenceGeneration = 1;
      this.liveArmed = false;
      this.cssomInstallById.clear();
      this.domInstallRoot = null;
      await this.page.evaluate(
        `typeof window.__speculumDomBumpGeneration === "function" && window.__speculumDomBumpGeneration(1)`,
      );
      await this.ensureClosedShadowPierce();
      this.onNavCommit();
      // Established after stream seed document + install are on the chain.
      const armed = await this.enqueueDocumentDiff();
      if (armed) this.established = true;
    } catch {
      /* mid-navigation */
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.virtualTelemetry?.stop();
    this.virtualTelemetry = null;
    this.cssomInstallById.clear();
    this.domInstallRoot = null;
    this.assets.clear();
    this.uploads.clear();
    if (this.cdp) {
      try {
        await this.cdp.detach();
      } catch {
        /* ignore */
      }
      this.cdp = null;
    }
  }

  /** Path-keyed or hash lookup for virtual-asset serve. */
  getAsset(key: string): { body: Buffer; contentType: string; sourceUrl?: string; mode: string } | undefined {
    const e = this.assets.get(key);
    if (!e) return undefined;
    return {
      body: e.body,
      contentType: e.contentType,
      sourceUrl: e.sourceUrl,
      mode: e.mode,
    };
  }

  async fetchPassThrough(
    key: string,
    rangeHeader?: string,
  ): Promise<{
    body: Buffer;
    contentType: string;
    statusCode: number;
    contentRange?: string;
  } | null> {
    const e = this.assets.get(key);
    const sourceUrl = e?.sourceUrl ?? (key.includes('://') ? key : `https://${key}`);
    try {
      const headers: Record<string, string> = {};
      if (rangeHeader) headers.Range = rangeHeader;
      const res = await this.page.context().request.get(sourceUrl, {
        timeout: 30_000,
        headers,
      });
      if (!res.ok() && res.status() !== 206) return null;
      const buf = Buffer.from(await res.body());
      const headerCt = res.headers()['content-type'];
      const ct =
        (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim()
        || e?.contentType
        || 'application/octet-stream';
      const cr = res.headers()['content-range'];
      const contentRange = typeof cr === 'string' ? cr : cr?.[0];
      // Cache small non-range responses for warm re-serve.
      if (!rangeHeader && buf.byteLength > 0 && buf.byteLength < 2 * 1024 * 1024) {
        this.assets.put(key, buf, ct, { sourceUrl, mode: 'pass-through' });
      }
      return {
        body: buf,
        contentType: ct,
        statusCode: res.status(),
        contentRange,
      };
    } catch {
      return null;
    }
  }

  putUpload(id: string, body: Buffer, contentType: string, name: string): void {
    this.uploads.set(id, { body, contentType, name });
  }

  takeUpload(id: string): { body: Buffer; contentType: string; name: string } | undefined {
    const u = this.uploads.get(id);
    if (u) this.uploads.delete(id);
    return u;
  }

  /** Epoch id of the Document the emitter is currently installed on (D4). */
  private async readDocumentEpoch(): Promise<string | null> {
    const epoch = await this.page.evaluate(
      'typeof window.__speculumDomEpochId === "function" ? window.__speculumDomEpochId() : null',
    );
    return typeof epoch === 'string' ? epoch : null;
  }

  private isBlankDocumentUrl(url: string): boolean {
    const u = (url || '').trim().toLowerCase();
    return !u || u === 'about:blank' || u === 'about:newtab' || u.startsWith('chrome://');
  }

  private async onMainFrameNavigated(): Promise<void> {
    try {
      this.chromiumPierceByAnchor.clear();
      this.chromiumPierceSheetIds.clear();
      await this.page.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);
      // T3/D4: framenavigated alone is not evidence of Document replacement.
      const epoch = await this.readDocumentEpoch();
      if (epoch === null) return;
      // Soft (same-document) navigation must never bump (D4).
      if (this.softNavEpoch !== null && epoch === this.softNavEpoch) {
        this.softNavEpoch = null;
        this.documentEpoch = epoch;
        return;
      }
      if (!this.established) {
        // First real Document — establish without GenerationBumped noise.
        if (!this.isBlankDocumentUrl(this.page.url())) {
          await this.establishBoot();
        }
        return;
      }
      if (epoch === this.documentEpoch) return;
      this.documentEpoch = epoch;

      // Disarm live path until the new epoch's document + install land (T10).
      this.liveArmed = false;
      this.cssomInstallById.clear();
      this.domInstallRoot = null;
      // Sidecar owns monotonic generation — never adopt a fresh page counter (T3).
      const fromGeneration = this.generation;
      this.generation += 1;
      await this.page.evaluate(
        `typeof window.__speculumDomBumpGeneration === "function" && window.__speculumDomBumpGeneration(${this.generation})`,
      );
      await this.ensureClosedShadowPierce();
      this.onNavCommit();
      this.events.onGenerationBumped?.({
        fromGeneration,
        toGeneration: this.generation,
        reason: 'main_frame_navigated',
        url: this.page.url(),
      });
      void this.enqueueDocumentDiff();
    } catch {
      /* mid-navigation */
    }
  }

  /**
   * T7: adopt closed shadow roots via CDP (declarative / pre-hook) into the
   * page-script WeakMap so F / MO / CSSOM pierce them like attachShadow hooks.
   */
  private async ensureClosedShadowPierce(): Promise<void> {
    if (this.stopped) return;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!this.cdp) {
          this.cdp = await this.page.context().newCDPSession(this.page);
          await this.cdp.send('DOM.enable');
          await this.cdp.send('Page.enable');
          try {
            const frameTree = (await this.cdp.send('Page.getFrameTree')) as {
              frameTree?: { frame?: { id?: string } };
            };
            const id = frameTree?.frameTree?.frame?.id;
            if (typeof id === 'string' && id) this.mainFrameCdpId = id;
          } catch {
            /* optional */
          }
          this.cdp.on('Page.frameNavigated', (ev: { frame?: { id?: string; parentId?: string } }) => {
            if (ev.frame && !ev.frame.parentId && typeof ev.frame.id === 'string') {
              this.mainFrameCdpId = ev.frame.id;
            }
          });
          this.cdp.on('Page.navigatedWithinDocument', (ev: { frameId?: string }) => {
            if (this.stopped) return;
            if (this.mainFrameCdpId && ev.frameId && ev.frameId !== this.mainFrameCdpId) return;
            void this.readDocumentEpoch()
              .then(async (epoch) => {
                if (epoch) this.softNavEpoch = epoch;
                let url: string | undefined;
                try {
                  url = this.page.url();
                } catch {
                  url = undefined;
                }
                this.events.onSoftNavObserved?.({
                  generation: this.generation,
                  url,
                  documentEpoch: epoch ?? undefined,
                  liveArmed: this.liveArmed,
                });
                // SoftNav = new pageEpoch without generation++ (parity load clock resets).
                this.onSoftNavCommit(url, epoch ?? undefined);
              })
              .catch(() => {});
          });
          this.cdp.on('DOM.shadowRootPushed', (ev: { hostId: number; root: { nodeId?: number; shadowRootType?: string } }) => {
            if (this.stopped) return;
            if (ev.root?.shadowRootType !== 'closed') return;
            const rootId = ev.root.nodeId;
            if (rootId == null) return;
            void this.adoptClosedShadowPair(ev.hostId, rootId, true);
          });
        }
        await this.adoptExistingClosedShadowsFromCdp();
        return;
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    }
    // attachShadow hook still covers JS closed roots; declarative closed shadows
    // remain incomplete if CDP never attaches — do not pretend success.
    if (lastError) {
      /* CDP unavailable — residual hole for declarative closed shadows */
    }
  }

  private async adoptExistingClosedShadowsFromCdp(): Promise<void> {
    if (!this.cdp || this.stopped) return;
    const doc = await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true }) as {
      root?: CdpDomNode;
    };
    if (!doc.root) return;
    const pairs: Array<{ hostId: number; shadowId: number }> = [];
    walkCdpClosedShadows(doc.root, pairs);
    for (const pair of pairs) {
      await this.adoptClosedShadowPair(pair.hostId, pair.shadowId, false);
    }
  }

  private async adoptClosedShadowPair(
    hostNodeId: number,
    shadowNodeId: number,
    publish: boolean,
  ): Promise<void> {
    if (!this.cdp || this.stopped) return;
    try {
      const hostResolved = await this.cdp.send('DOM.resolveNode', { nodeId: hostNodeId }) as {
        object?: { objectId?: string };
      };
      const shadowResolved = await this.cdp.send('DOM.resolveNode', { nodeId: shadowNodeId }) as {
        object?: { objectId?: string };
      };
      const hostId = hostResolved.object?.objectId;
      const shadowId = shadowResolved.object?.objectId;
      if (!hostId || !shadowId) return;
      // Prefer the realm that owns the host (pierce satellite / top). Fall back
      // to window.top so child-frame hosts still reach the top emitter when the
      // satellite is not installed yet.
      await this.cdp.send('Runtime.callFunctionOn', {
        objectId: hostId,
        arguments: [{ objectId: shadowId }, { value: publish }],
        functionDeclaration: `function(shadow, publish) {
          var adopt = typeof window.__speculumDomAdoptClosedShadow === 'function'
            ? window.__speculumDomAdoptClosedShadow
            : null;
          if (!adopt) {
            try {
              if (window.top && typeof window.top.__speculumDomAdoptClosedShadow === 'function') {
                adopt = window.top.__speculumDomAdoptClosedShadow;
              }
            } catch (e) {}
          }
          return typeof adopt === 'function' && adopt(this, shadow, publish);
        }`,
        returnByValue: true,
      });
    } catch {
      /* node may have been collected mid-flight */
    }
  }

  /**
   * T7: pierce a cross-origin iframe via frame.contentFrame() + satellite map.
   */
  private enqueueChromiumIframePierce(anchor: string): void {
    this.chromiumPierceChain = this.chromiumPierceChain
      .then(() => this.pierceIframeViaChromium(anchor))
      .catch(() => undefined);
  }

  private async onChildFrameNavigated(frame: Frame): Promise<void> {
    const anchor = this.chromiumPierceByFrame.get(frame);
    if (!anchor) return;
    this.enqueueChromiumIframePierce(anchor);
  }

  private async pierceIframeViaChromium(anchor: string): Promise<void> {
    if (this.stopped || !anchor) return;
    let handle: ElementHandle | null = null;
    try {
      const evaluated = await this.page.evaluateHandle((a) => {
        const w = globalThis as typeof globalThis & {
          __speculumDomResolve?: (anchor: string) => unknown;
        };
        return w.__speculumDomResolve?.(a) ?? null;
      }, anchor);
      handle = evaluated.asElement() as ElementHandle | null;
      if (!handle) {
        await evaluated.dispose().catch(() => undefined);
        return;
      }
      const frame = await handle.contentFrame();
      if (!frame || frame === this.page.mainFrame()) return;

      this.chromiumPierceByAnchor.set(anchor, frame);
      this.chromiumPierceByFrame.set(frame, anchor);

      await frame.evaluate(
        `window.__speculumPierceHostAnchor = ${JSON.stringify(anchor)};`,
      );
      // Force reinstall on document swap (G-B) — clear prior satellite marker.
      await frame.evaluate(
        'try { delete window.__speculumDomPierceInstalled; } catch (e) {}',
      );
      await frame.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);

      const mapped = (await frame.evaluate(`(() => {
        const root = typeof window.__speculumDomMapPierceRoot === 'function'
          ? window.__speculumDomMapPierceRoot()
          : null;
        const sheets = typeof window.__speculumDomMapPierceCssom === 'function'
          ? window.__speculumDomMapPierceCssom()
          : [];
        return { root, sheets };
      })()`)) as { root?: DomNodeJson | null; sheets?: unknown[] };

      await this.applyChromiumIframePublish(anchor, mapped?.root ?? null, mapped?.sheets ?? []);
      // Closed shadows inside the pierce frame may now have a local adopt hook.
      await this.ensureClosedShadowPierce();
    } catch {
      /* frame detached / mid-navigation */
    } finally {
      if (handle) await handle.dispose().catch(() => undefined);
    }
  }

  private async applyChromiumIframePublish(
    anchor: string,
    root: unknown,
    sheets: unknown,
  ): Promise<void> {
    if (this.stopped || !anchor || !root || typeof root !== 'object') return;
    const rootNode = root as DomNodeJson;
    // `null` = Dom-only remount (live MO). Array (incl. empty) = pierce establish/swap (C7).
    const sheetEstablish = Array.isArray(sheets);
    const sheetList = sheetEstablish ? (sheets as unknown[]) : null;
    this.enqueue(async () => {
      try {
        await this.rewriteRemoteAssets([rootNode]);
        const meta = (await this.page.evaluate(
          ([a, r]) => {
            const w = globalThis as typeof globalThis & {
              __speculumDomApplyChromiumIframePierce?: (
                anchor: string,
                root: unknown,
                silent?: boolean,
              ) => { selector: { kind: string; query: string; index?: number }; removeExisting: boolean } | null;
            };
            // silent: sidecar emits Dom then Cssom (C7 order).
            return w.__speculumDomApplyChromiumIframePierce?.(a, r, true) ?? null;
          },
          [anchor, rootNode] as [string, DomNodeJson],
        )) as { selector: { kind: string; query: string; index?: number }; removeExisting: boolean } | null;

        if (!meta?.selector?.query) return;

        const removed = meta.removeExisting
          ? [{ selector: { kind: 'childAt', query: meta.selector.query, index: 0 } }]
          : [];
        await this.materializeAndPush('dom', 'childList', {
          selector: meta.selector,
          removed,
          added: [{ index: 0, node: rootNode }],
        });

        if (sheetEstablish && sheetList) {
          const prevIds = [...(this.chromiumPierceSheetIds.get(anchor) ?? [])];
          const cssomRemoved = prevIds.map((id) => ({ selector: { kind: 'sheet', id } }));
          const added = sheetList.map((sheet, index) => ({ index, sheet }));
          if (cssomRemoved.length > 0 || added.length > 0) {
            await this.materializeAndPush('cssom', 'sheetList', {
              removed: cssomRemoved,
              added,
            });
          } else {
            this.chromiumPierceSheetIds.set(anchor, new Set());
          }
        }
      } catch {
        /* ignore */
      }
    });
  }

  /** C7: host kill / XO pierce teardown — drop every sheet scoped to this host. */
  private teardownChromiumIframeCssom(anchor: string): void {
    if (!anchor) return;
    this.chromiumPierceByAnchor.delete(anchor);
    const prevIds = [...(this.chromiumPierceSheetIds.get(anchor) ?? [])];
    this.chromiumPierceSheetIds.delete(anchor);
    if (prevIds.length === 0) return;
    this.enqueue(async () => {
      await this.materializeAndPush('cssom', 'sheetList', {
        removed: prevIds.map((id) => ({ selector: { kind: 'sheet', id } })),
        added: [],
      });
    });
  }

  /** Track pierceHost sheet ids so XO swap/kill can emit C7 removes. */
  private noteCssomSheetList(payload: PageProjectionEmitPayload): void {
    const removed = Array.isArray(payload.removed)
      ? (payload.removed as Array<{ selector?: { id?: string } }>)
      : [];
    for (const entry of removed) {
      const id = entry?.selector?.id;
      if (!id) continue;
      for (const set of this.chromiumPierceSheetIds.values()) set.delete(id);
    }
    const added = Array.isArray(payload.added)
      ? (payload.added as Array<{
          sheet?: { id?: string; scope?: { kind?: string; hostAnchor?: string } };
        }>)
      : [];
    for (const entry of added) {
      const sheet = entry?.sheet;
      const id = sheet?.id;
      const scope = sheet?.scope;
      if (!id || scope?.kind !== 'pierceHost' || !scope.hostAnchor) continue;
      let set = this.chromiumPierceSheetIds.get(scope.hostAnchor);
      if (!set) {
        set = new Set();
        this.chromiumPierceSheetIds.set(scope.hostAnchor, set);
      }
      set.add(id);
    }
  }

  /**
   * OOB resync snapshot (T8/C8) — does **not** advance live `sequence`.
   * Dom comes from the live install mirror when hot (no Virtual DomMap);
   * Cssom from the Cssom install mirror. Pause live emit for the capture, then T5 re-establish.
   */
  async captureResyncSnapshot(): Promise<{
    generation: number;
    coversThroughSequence: number;
    root: DomNodeJson;
    sheets: unknown[];
    pageEpochId: string;
    source: 'mirror' | 'dump_fallback';
    domMapMs: number;
    cssomCloneMs: number;
    rewriteMs: number;
    serializeMs: number;
    domMapPhases?: DomMapPhaseTimings & {
      cdpTransferMs?: number;
      evaluateWallMs?: number;
      mirror?: boolean;
    };
  } | null> {
    if (this.stopped) return null;
    // Pre-establish resync would invent watermark 0 — refuse (T8 / T10).
    if (!this.established) return null;
    await this.pauseLiveEmitForBackpressure();
    try {
      const snap = await this.runOnMaterializeChain(async () => {
        try {
          const pageEpochId = this.pageEpochId ?? '';
          this.emitParity('parity_establish_dom_map_started', {
            pageEpochId,
            generation: this.generation,
            path: 'resync',
            tVirtualMs: this.tVirtualMs(),
          });
          const domMapStartMs = Date.now();
          let root: DomNodeJson | null = null;
          let mappedTimings: DomMapPhaseTimings | undefined;
          let usedDomMirror = false;
          let evaluateWallMs = 0;

          const mirrored = this.cloneDomInstallMirror();
          if (mirrored) {
            usedDomMirror = true;
            root = mirrored;
            evaluateWallMs = Date.now() - domMapStartMs;
            mappedTimings = {
              takeRecordsMs: 0,
              clearLedgerMs: 0,
              anchorAllMs: 0,
              remintMs: 0,
              mapNodeMs: 0,
              resetPublishedMs: 0,
              cssomMs: 0,
              pageTotalMs: 0,
            };
          } else {
            const mapped = (await this.page.evaluate(
              `typeof window.__speculumDomMapDocumentResync === "function"
                ? window.__speculumDomMapDocumentResync()
                : window.__speculumDomMapDocument()`,
            )) as Record<string, unknown> | null;
            evaluateWallMs = Date.now() - domMapStartMs;
            const parsed = parseMappedDomEvaluate(mapped);
            root = parsed.root;
            mappedTimings = parsed.timings;
          }

          const domMapMs = evaluateWallMs;
          if (!root) {
            this.emitParity('parity_establish_failed', {
              pageEpochId,
              generation: this.generation,
              errorCode: 'dom_map_empty',
              phase: 'dom_map_resync',
              tVirtualMs: this.tVirtualMs(),
            });
            return null;
          }
          const approxNodes = countNodesApprox(root);
          this.emitParity(
            'parity_establish_dom_map_completed',
            this.domMapCompletedPayload({
              pageEpochId,
              generation: this.generation,
              path: 'resync',
              evaluateWallMs,
              approxNodes,
              timings: mappedTimings,
              mirror: usedDomMirror,
            }),
          );
          // OOB: rewrite URLs without awaiting asset bodies — pass-through warms on demand.
          // Mirror roots are already rewritten; rewrite is then a cheap no-op pass.
          const rewriteStartMs = Date.now();
          await this.rewriteRemoteAssets([root], { deferFetches: true });
          const rewriteMs = Date.now() - rewriteStartMs;

          const cssomCloneStartMs = Date.now();
          let sheets: CssomMirrorSheet[] = this.cloneCssomInstallMirror();
          let source: 'mirror' | 'dump_fallback' = 'mirror';
          // Cold edge: Cssom mirror empty before first install landed — one-shot dump fallback.
          if (sheets.length === 0) {
            source = 'dump_fallback';
            const cssom = (await this.page.evaluate('window.__speculumDomMapCssom()')) as {
              sheets?: CssomMirrorSheet[];
            };
            sheets = Array.isArray(cssom?.sheets) ? [...cssom.sheets] : [];
            for (const [hostAnchor, frame] of this.chromiumPierceByAnchor) {
              if (this.stopped) break;
              try {
                if (frame.isDetached()) {
                  this.chromiumPierceByAnchor.delete(hostAnchor);
                  continue;
                }
                const pierceSheets = (await frame.evaluate(
                  `typeof window.__speculumDomMapPierceCssom === "function" ? window.__speculumDomMapPierceCssom() : []`,
                )) as CssomMirrorSheet[];
                if (Array.isArray(pierceSheets)) sheets.push(...pierceSheets);
              } catch {
                /* frame gone mid-resync */
              }
            }
            await this.seedCssomSheets('install', { sheets });
            this.rewriteCssomPayload('install', { sheets });
            this.replaceCssomInstallMirror(sheets);
          }
          const cssomCloneMs = Date.now() - cssomCloneStartMs;

          const serializeStartMs = Date.now();
          JSON.stringify(root);
          JSON.stringify(sheets);
          const serializeMs = Date.now() - serializeStartMs;

          const pageTotalMs = Math.max(0, Number(mappedTimings?.pageTotalMs ?? 0) || 0);
          return {
            generation: this.generation,
            coversThroughSequence: this.sequence,
            root,
            sheets,
            pageEpochId: this.pageEpochId ?? '',
            source,
            domMapMs,
            cssomCloneMs,
            rewriteMs,
            serializeMs,
            domMapPhases: {
              ...(mappedTimings ?? {}),
              evaluateWallMs,
              cdpTransferMs: Math.max(0, evaluateWallMs - pageTotalMs),
              mirror: usedDomMirror,
            },
          };
        } catch {
          return null;
        }
      });
      return snap;
    } finally {
      // T5: re-establish so paused mutations are not a silent chronology hole.
      void this.resumeLiveEmitAfterBackpressure();
    }
  }

  /**
   * @deprecated Does not publish OOB resync. Use `captureResyncSnapshot` and the
   * Watch/GetPageProjectionResync transport (T8).
   */
  async requestResync(): ReturnType<PageProjection['captureResyncSnapshot']> {
    if (this.stopped) return null;
    return this.captureResyncSnapshot();
  }

  getGeneration(): number {
    return this.generation;
  }

  /**
   * T5 backpressure defer: stop page live emit while EventBridge Dom is near capacity.
   * MO keeps running; emit() no-ops until resume re-establishes.
   */
  async pauseLiveEmitForBackpressure(): Promise<void> {
    if (this.stopped || !this.established) return;
    try {
      await this.page.evaluate(
        `typeof window.__speculumDomPauseLiveEmit === "function" && window.__speculumDomPauseLiveEmit()`,
      );
    } catch {
      /* mid-nav */
    }
  }

  /**
   * After Dom queue drains: re-establish so deferred mutations are not a silent hole (T5).
   * Hot Dom+Cssom mirrors re-push without remap; otherwise full MapAndArm fail-safe.
   */
  async resumeLiveEmitAfterBackpressure(): Promise<void> {
    if (this.stopped || !this.established) return;
    if (this.domInstallRoot && this.cssomInstallById.size > 0) {
      await this.runOnMaterializeChain(async () => {
        if (this.stopped || !this.domInstallRoot || this.cssomInstallById.size === 0) {
          await this.enqueueFullMapEstablish();
          return;
        }
        try {
          await this.page.evaluate(
            `typeof window.__speculumDomPauseLiveEmit === "function" && window.__speculumDomPauseLiveEmit();
             typeof window.__speculumDomArmLiveEmit === "function" && window.__speculumDomArmLiveEmit();`,
          );
        } catch {
          await this.enqueueFullMapEstablish();
          return;
        }
        this.liveArmed = true;
        await this.materializeAndPush('dom', 'document', {
          root: structuredClone(this.domInstallRoot),
        });
        await this.materializeAndPush('cssom', 'install', {
          sheets: this.cloneCssomInstallMirror(),
        });
      });
      return;
    }
    await this.enqueueFullMapEstablish();
  }

  /** Serialize work with Dom/Cssom emits so chronology stays contiguous (T8). */
  private runOnMaterializeChain<T>(work: () => Promise<T>): Promise<T> {
    const done = this.materializeChain.then(work, work);
    this.materializeChain = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  }

  /** C4 — wait for pending stylesheet links before install / resync map. */
  private async waitStylesheetsReady(timeoutMs: number): Promise<{ ready: boolean }> {
    try {
      const result = (await this.page.evaluate(
        `typeof window.__speculumDomWaitStylesheetsReady === "function"
          ? window.__speculumDomWaitStylesheetsReady(${Math.max(0, timeoutMs | 0)})
          : null`,
      )) as { ready?: boolean } | null;
      return { ready: result?.ready !== false };
    } catch {
      /* mid-navigation */
      return { ready: false };
    }
  }

  /**
   * Stream establish (product cold / hard-nav): shallow html/head/body seed + arm,
   * then catch-up emits for nodes already under the roots. No full DomMap.
   */
  private enqueueDocumentDiff(): Promise<boolean> {
    return this.enqueueStreamEstablish();
  }

  private enqueueStreamEstablish(): Promise<boolean> {
    return new Promise((resolve) => {
      this.enqueue(async () => {
        let armed = false;
        const pageEpochId = this.pageEpochId ?? '';
        const generation = this.generation;
        const establishStartMs = Date.now();
        try {
          this.liveArmed = false;
          this.emitParity('parity_establish_dom_map_started', {
            pageEpochId,
            generation,
            path: 'seed',
            tVirtualMs: this.tVirtualMs(),
          });
          const seedStartMs = Date.now();
          const mappedRaw = (await this.page.evaluate(
            `typeof window.__speculumDomSeedAndArmEstablish === "function"
              ? window.__speculumDomSeedAndArmEstablish()
              : typeof window.__speculumDomMapAndArmEstablish === "function"
                ? window.__speculumDomMapAndArmEstablish()
                : null`,
          )) as Record<string, unknown> | null;
          const evaluateWallMs = Date.now() - seedStartMs;
          const mapped = parseMappedDomEvaluate(mappedRaw);
          if (!mapped.root) {
            this.emitParity('parity_establish_failed', {
              pageEpochId,
              generation,
              errorCode: 'dom_seed_empty',
              phase: 'dom_seed',
              tVirtualMs: this.tVirtualMs(),
            });
            return;
          }
          this.emitParity(
            'parity_establish_dom_map_completed',
            this.domMapCompletedPayload({
              pageEpochId,
              generation,
              path: 'establish',
              evaluateWallMs,
              approxNodes: countNodesApprox(mapped.root),
              timings: mapped.timings,
            }),
          );

          this.liveArmed = true;
          await this.materializeAndPush('dom', 'document', { root: mapped.root });
          this.noteFirstDiffEmitted('dom', 'document');

          const sheets = Array.isArray(mapped.sheets) ? mapped.sheets : [];
          this.emitParity('parity_establish_cssom_install_started', {
            pageEpochId,
            generation,
            source: 'seed',
            tVirtualMs: this.tVirtualMs(),
          });
          const cssomStartMs = Date.now();
          this.lastSeededSheetCount = 0;
          await this.materializeAndPush('cssom', 'install', { sheets });
          const { sheetCount, ruleCount } = summarizeSheets(sheets);
          this.emitParity('parity_establish_cssom_install_completed', {
            pageEpochId,
            generation,
            source: 'seed',
            durationMs: Date.now() - cssomStartMs,
            sheetCount,
            ruleCount,
            seededSheetCount: this.lastSeededSheetCount,
            tVirtualMs: this.tVirtualMs(),
          });
          this.noteFirstDiffEmitted('cssom', 'install');

          // SSR/progressive catch-up: one document upgrade after interactive, then arm live.
          this.emitParity('parity_establish_dom_map_started', {
            pageEpochId,
            generation,
            path: 'bootstrap',
            tVirtualMs: this.tVirtualMs(),
          });
          const bootStartMs = Date.now();
          const bootRaw = (await this.page.evaluate(
            `typeof window.__speculumDomBootstrapMap === "function"
              ? window.__speculumDomBootstrapMap(8000)
              : null`,
          )) as Record<string, unknown> | null;
          const bootWallMs = Date.now() - bootStartMs;
          const boot = parseMappedDomEvaluate(bootRaw);
          if (boot.root) {
            this.emitParity(
              'parity_establish_dom_map_completed',
              this.domMapCompletedPayload({
                pageEpochId,
                generation,
                path: 'establish',
                evaluateWallMs: bootWallMs,
                approxNodes: countNodesApprox(boot.root),
                timings: boot.timings,
              }),
            );
            await this.materializeAndPush('dom', 'document', { root: boot.root });
            const bootSheets = Array.isArray(boot.sheets) ? boot.sheets : [];
            this.lastSeededSheetCount = 0;
            await this.materializeAndPush('cssom', 'install', { sheets: bootSheets });
            try {
              await this.page.evaluate(
                `typeof window.__speculumDomArmStreamLive === "function" && window.__speculumDomArmStreamLive()`,
              );
            } catch {
              /* mid-nav */
            }
          }

          armed = true;
          this.emitParity('parity_establish_completed', {
            pageEpochId,
            generation,
            totalMs: Date.now() - establishStartMs,
            tSinceCommitMs: this.tSinceCommitMs(),
            tVirtualMs: this.tVirtualMs(),
            mode: 'stream_seed',
          });
        } catch (err) {
          this.liveArmed = false;
          this.emitParity('parity_establish_failed', {
            pageEpochId,
            generation,
            errorCode: 'establish_exception',
            phase: 'establish',
            message: err instanceof Error ? err.message.slice(0, 256) : String(err).slice(0, 256),
            tVirtualMs: this.tVirtualMs(),
          });
        } finally {
          resolve(armed);
        }
      });
    });
  }

  /**
   * Fail-safe full DomMap+Cssom establish (mirror miss / lab). Not the product cold path.
   */
  private enqueueFullMapEstablish(): Promise<boolean> {
    return new Promise((resolve) => {
      this.enqueue(async () => {
        let armed = false;
        const pageEpochId = this.pageEpochId ?? '';
        const generation = this.generation;
        const establishStartMs = Date.now();
        try {
          this.liveArmed = false;
          this.emitParity('parity_establish_dom_map_started', {
            pageEpochId,
            generation,
            path: 'establish_full',
            tVirtualMs: this.tVirtualMs(),
          });
          const domMapStartMs = Date.now();
          const mappedRaw = (await this.page.evaluate(
            `typeof window.__speculumDomMapAndArmEstablish === "function"
              ? window.__speculumDomMapAndArmEstablish()
              : null`,
          )) as Record<string, unknown> | null;
          const evaluateWallMs = Date.now() - domMapStartMs;
          const mapped = parseMappedDomEvaluate(mappedRaw);
          if (!mapped.root) {
            this.emitParity('parity_establish_failed', {
              pageEpochId,
              generation,
              errorCode: 'dom_map_empty',
              phase: 'dom_map',
              tVirtualMs: this.tVirtualMs(),
            });
            return;
          }
          this.emitParity(
            'parity_establish_dom_map_completed',
            this.domMapCompletedPayload({
              pageEpochId,
              generation,
              path: 'establish',
              evaluateWallMs,
              approxNodes: countNodesApprox(mapped.root),
              timings: mapped.timings,
            }),
          );
          this.liveArmed = true;
          await this.materializeAndPush('dom', 'document', { root: mapped.root });
          this.noteFirstDiffEmitted('dom', 'document');
          if (Array.isArray(mapped.sheets)) {
            this.emitParity('parity_establish_cssom_install_started', {
              pageEpochId,
              generation,
              source: 'full_map',
              tVirtualMs: this.tVirtualMs(),
            });
            const cssomStartMs = Date.now();
            this.lastSeededSheetCount = 0;
            await this.materializeAndPush('cssom', 'install', { sheets: mapped.sheets });
            const { sheetCount, ruleCount } = summarizeSheets(mapped.sheets);
            this.emitParity('parity_establish_cssom_install_completed', {
              pageEpochId,
              generation,
              source: 'full_map',
              durationMs: Date.now() - cssomStartMs,
              sheetCount,
              ruleCount,
              seededSheetCount: this.lastSeededSheetCount,
              tVirtualMs: this.tVirtualMs(),
            });
            this.noteFirstDiffEmitted('cssom', 'install');
          }
          armed = true;
          this.emitParity('parity_establish_completed', {
            pageEpochId,
            generation,
            totalMs: Date.now() - establishStartMs,
            tSinceCommitMs: this.tSinceCommitMs(),
            tVirtualMs: this.tVirtualMs(),
            mode: 'full_map',
          });
        } catch (err) {
          this.liveArmed = false;
          this.emitParity('parity_establish_failed', {
            pageEpochId,
            generation,
            errorCode: 'establish_exception',
            phase: 'establish',
            message: err instanceof Error ? err.message.slice(0, 256) : String(err).slice(0, 256),
            tVirtualMs: this.tVirtualMs(),
          });
        } finally {
          resolve(armed);
        }
      });
    });
  }

  /** Fires once per epoch — marks the first Dom/Cssom diff that reaches the wire. */
  private noteFirstDiffEmitted(plane: string, operation: string): void {
    if (this.firstDiffEmittedForEpoch) return;
    this.firstDiffEmittedForEpoch = true;
    this.emitParity('parity_establish_first_diff_emitted', {
      pageEpochId: this.pageEpochId ?? '',
      generation: this.generation,
      plane,
      operation,
      sequence: this.sequence,
      tSinceCommitMs: this.tSinceCommitMs(),
      tVirtualMs: this.tVirtualMs(),
    });
  }

  private emitFromPage(emitted: unknown): void {
    // Drop live page traffic until stream seed (document + install) armed this epoch.
    if (!this.liveArmed) return;
    if (!emitted || typeof emitted !== 'object') return;
    const p = emitted as {
      generation?: number;
      plane?: string;
      operation?: string;
      payload?: PageProjectionEmitPayload;
    };
    const plane = p.plane === 'cssom' ? 'cssom' : p.plane === 'dom' ? 'dom' : null;
    const operation = typeof p.operation === 'string' ? p.operation.trim() : '';
    if (!plane || !operation || !p.payload || typeof p.payload !== 'object') return;

    // Page script may restart at generation=1 after Document reinstall. Sidecar
    // owns the wire epoch: never decrease; only adopt a higher page counter.
    if (typeof p.generation === 'number' && p.generation > this.generation) {
      const fromGeneration = this.generation;
      this.generation = p.generation;
      this.events.onGenerationBumped?.({
        fromGeneration,
        toGeneration: p.generation,
        reason: 'page_emit_sync',
        diffKind: operation,
        url: this.page.url(),
      });
    }

    const payload = p.payload;
    this.enqueue(() => this.materializeAndPush(plane, operation, payload));
  }

  private enqueue(work: () => Promise<void>): void {
    this.materializeChain = this.materializeChain.then(work).catch(() => {});
  }

  private async materializeAndPush(
    plane: 'dom' | 'cssom',
    operation: string,
    payload: PageProjectionEmitPayload,
  ): Promise<void> {
    if (this.stopped) return;
    if (plane === 'dom') {
      await this.rewriteDomPayload(operation, payload);
    } else {
      await this.seedCssomSheets(operation, payload);
      this.rewriteCssomPayload(operation, payload);
      this.updateCssomInstallMirror(operation, payload);
      if (operation === 'sheetList') this.noteCssomSheetList(payload);
    }
    if (this.stopped) return;
    this.push(plane, operation, payload);
    // Dom mirror after push so LMS stamp is included (same bytes as the wire).
    if (plane === 'dom') this.updateDomInstallMirror(operation, payload);
  }

  private cloneDomInstallMirror(): DomNodeJson | null {
    return this.domInstallRoot ? structuredClone(this.domInstallRoot) : null;
  }

  private invalidateDomInstallMirror(reason?: string, detail?: Record<string, unknown>): void {
    void reason;
    void detail;
    this.domInstallRoot = null;
  }

  /**
   * Keep OOB Dom mirror in lockstep with live Dom wire state.
   * Fail-safe: any apply miss drops the mirror → next OOB remaps from Virtual.
   */
  private updateDomInstallMirror(
    operation: string,
    payload: PageProjectionEmitPayload,
  ): void {
    if (operation === 'document') {
      const root = payload.root as DomNodeJson | undefined;
      if (root && typeof root === 'object' && typeof root.tag === 'string') {
        this.domInstallRoot = structuredClone(root);
      } else {
        this.invalidateDomInstallMirror('document_empty');
      }
      return;
    }
    if (!this.domInstallRoot) return;
    if (operation === 'scrollViewport' || operation === 'scrollElement') return;
    if (operation === 'childList') {
      const applied = applyDomMirrorChildList(this.domInstallRoot, payload);
      if (!applied.ok) {
        const sel = payload.selector as { query?: string; kind?: string } | undefined;
        this.invalidateDomInstallMirror('childList_apply', {
          reason: applied.reason,
          selectorKind: sel?.kind ?? '',
          selectorQuery: typeof sel?.query === 'string' ? sel.query.slice(0, 160) : '',
          removedCount: Array.isArray(payload.removed) ? payload.removed.length : 0,
          addedCount: Array.isArray(payload.added) ? payload.added.length : 0,
        });
      }
      return;
    }
    if (operation === 'patch') {
      // Soft-skip like Cssom rule patch miss — do not wipe the whole Dom mirror for a
      // single address miss (remint / race). Structural parent_miss still invalidates.
      void applyDomMirrorPatch(this.domInstallRoot, payload);
      return;
    }
  }

  private cloneCssomInstallMirror(): CssomMirrorSheet[] {
    return structuredClone([...this.cssomInstallById.values()]);
  }

  private replaceCssomInstallMirror(sheets: CssomMirrorSheet[]): void {
    this.cssomInstallById.clear();
    for (const sheet of sheets) {
      const id = typeof sheet?.id === 'string' ? sheet.id : '';
      if (!id) continue;
      this.cssomInstallById.set(id, structuredClone(sheet));
    }
  }

  /** Keep OOB install mirror in lockstep with live Cssom wire state (C8). */
  private updateCssomInstallMirror(
    operation: string,
    payload: PageProjectionEmitPayload,
  ): void {
    if (operation === 'install' && Array.isArray(payload.sheets)) {
      this.replaceCssomInstallMirror(payload.sheets as CssomMirrorSheet[]);
      return;
    }
    if (operation === 'sheetList') {
      const removed = Array.isArray(payload.removed) ? (payload.removed as string[]) : [];
      for (const id of removed) this.cssomInstallById.delete(String(id));
      const added = Array.isArray(payload.added)
        ? (payload.added as Array<{ sheet?: CssomMirrorSheet }>)
        : [];
      for (const entry of added) {
        const sheet = entry?.sheet;
        const id = typeof sheet?.id === 'string' ? sheet.id : '';
        if (!id || !sheet) continue;
        this.cssomInstallById.set(id, structuredClone(sheet));
      }
      return;
    }
    if (operation === 'ruleList') {
      const sheetId =
        payload.selector && typeof payload.selector === 'object'
          ? String((payload.selector as { id?: string }).id ?? '')
          : '';
      const sheet = sheetId ? this.cssomInstallById.get(sheetId) : undefined;
      if (!sheet) return;
      const removed = Array.isArray(payload.removed) ? (payload.removed as string[]) : [];
      if (removed.length && Array.isArray(sheet.rules)) {
        const drop = new Set(removed.map(String));
        sheet.rules = sheet.rules.filter((r) => !drop.has(String(r.id ?? '')));
      }
      const added = Array.isArray(payload.added)
        ? (payload.added as Array<{ rule?: { id?: string; cssText?: string } }>)
        : [];
      if (!Array.isArray(sheet.rules)) sheet.rules = [];
      for (const entry of added) {
        const rule = entry?.rule;
        if (!rule || typeof rule.id !== 'string' || !rule.id) continue;
        sheet.rules.push(structuredClone(rule));
      }
      return;
    }
    if (operation === 'patch') {
      const ruleId =
        payload.selector && typeof payload.selector === 'object'
          ? String((payload.selector as { id?: string }).id ?? '')
          : typeof (payload.rule as { id?: string } | undefined)?.id === 'string'
            ? String((payload.rule as { id: string }).id)
            : '';
      const next = payload.rule as { id?: string; cssText?: string } | undefined;
      if (!ruleId || !next) return;
      for (const sheet of this.cssomInstallById.values()) {
        const rules = sheet.rules;
        if (!Array.isArray(rules)) continue;
        const idx = rules.findIndex((r) => String(r.id ?? '') === ruleId);
        if (idx < 0) continue;
        rules[idx] = structuredClone({ ...rules[idx], ...next, id: ruleId });
        return;
      }
    }
  }

  /**
   * C6.5 — when cssRules were CORS-blocked, fill empty sheets from the asset
   * cache (awaiting fetch). `href` is sidecar-local and stripped before wire.
   */
  private async seedCssomSheets(
    operation: string,
    payload: PageProjectionEmitPayload,
  ): Promise<void> {
    const targets: Array<{ rules?: Array<{ id: string; cssText: string }>; href?: string; id?: string }> =
      [];
    if (operation === 'install' && Array.isArray(payload.sheets)) {
      targets.push(
        ...(payload.sheets as Array<{ rules?: Array<{ id: string; cssText: string }>; href?: string; id?: string }>),
      );
    } else if (operation === 'sheetList' && Array.isArray(payload.added)) {
      for (const entry of payload.added as Array<{ sheet?: { rules?: Array<{ id: string; cssText: string }>; href?: string; id?: string } }>) {
        if (entry?.sheet) targets.push(entry.sheet);
      }
    }
    for (const sheet of targets) {
      if (!sheet) continue;
      const href = typeof sheet.href === 'string' ? sheet.href : '';
      delete sheet.href;
      if (Array.isArray(sheet.rules) && sheet.rules.length > 0) continue;
      if (!href || !/^https?:\/\//i.test(href)) continue;
      const key = virtualAssetKeyFromUrl(href);
      if (!key) continue;
      await this.kickFetch(href, key);
      const entry = this.assets.get(key);
      if (!entry?.body?.byteLength) continue;
      const css = entry.body.toString('utf8');
      if (!css.trim()) continue;
      const sheetId = typeof sheet.id === 'string' && sheet.id ? sheet.id : key;
      sheet.rules = [{ id: `seed:${sheetId}`, cssText: css }];
      this.lastSeededSheetCount += 1;
    }
  }

  /** Virtual stamps a local counter; the official sequence lands here. */
  private stampLmsInPayload(payload: PageProjectionEmitPayload, sequence: number): void {
    const stampNode = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as DomNodeJson;
      if (n.tag && n.tag !== '#text') {
        n.attrs = { ...(n.attrs ?? {}), 'speculum-last-mutation-sequence': String(sequence) };
      }
      for (const c of n.children ?? []) stampNode(c);
    };
    if (payload.root) stampNode(payload.root);
    if (payload.node) stampNode(payload.node);
    if (Array.isArray(payload.added)) {
      for (const entry of payload.added as Array<{ node?: DomNodeJson }>) {
        if (entry?.node) stampNode(entry.node);
      }
    }
  }

  private async rewriteDomPayload(
    operation: string,
    payload: PageProjectionEmitPayload,
  ): Promise<void> {
    const nodes: DomNodeJson[] = [];
    if (operation === 'document' && payload.root) {
      nodes.push(payload.root as DomNodeJson);
    } else if (operation === 'childList' && Array.isArray(payload.added)) {
      for (const entry of payload.added as Array<{ node?: DomNodeJson }>) {
        if (entry?.node) nodes.push(entry.node);
      }
    } else if (operation === 'patch' && payload.node) {
      nodes.push(payload.node as DomNodeJson);
    }
    if (!nodes.length) return;
    await this.rewriteRemoteAssets(nodes);
  }

  private rewriteCssomPayload(operation: string, payload: PageProjectionEmitPayload): void {
    const rewriteRule = (rule: { cssText?: string } | undefined) => {
      if (rule && typeof rule.cssText === 'string') {
        rule.cssText = this.rewriteCssTextAssets(rule.cssText);
      }
    };
    const rewriteSheet = (sheet: { rules?: Array<{ cssText?: string }> } | undefined) => {
      for (const rule of sheet?.rules ?? []) rewriteRule(rule);
    };
    if (operation === 'install' && Array.isArray(payload.sheets)) {
      for (const sheet of payload.sheets as Array<{ rules?: Array<{ cssText?: string }> }>) {
        rewriteSheet(sheet);
      }
      return;
    }
    if (operation === 'sheetList' && Array.isArray(payload.added)) {
      for (const entry of payload.added as Array<{ sheet?: { rules?: Array<{ cssText?: string }> } }>) {
        rewriteSheet(entry?.sheet);
      }
      return;
    }
    if (operation === 'ruleList' && Array.isArray(payload.added)) {
      for (const entry of payload.added as Array<{ rule?: { cssText?: string } }>) {
        rewriteRule(entry?.rule);
      }
      return;
    }
    if (operation === 'patch') {
      rewriteRule(payload.rule as { cssText?: string } | undefined);
    }
  }

  /** Absolutize + virtualize `url(...)` / `@import "..."` inside rule text, warming the cache. */
  private rewriteCssTextAssets(cssText: string): string {
    let pageBase = 'https://invalid.local/';
    try {
      pageBase = this.page.url() || pageBase;
    } catch {
      /* */
    }
    const foldUrl = (raw: string): string | null => {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/')) return null;
      let abs = trimmed;
      if (!/^https?:\/\//i.test(abs)) {
        try {
          abs = new URL(trimmed, pageBase).href;
        } catch {
          return null;
        }
      }
      if (!/^https?:\/\//i.test(abs)) return null;
      const key = virtualAssetKeyFromUrl(abs);
      if (!key) return null;
      void this.kickFetch(abs, key);
      return `${VIRTUAL_ASSETS_PREFIX}${key}`;
    };
    let out = cssText.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
      const mapped = foldUrl(raw);
      return mapped ? `url(${quote}${mapped}${quote})` : match;
    });
    // Bare-string @import "x" (not url()) — CSS engine fetches these without our auth stamp.
    out = out.replace(
      /@import\s+(?!url\()(['"])([^'"]+)\1/gi,
      (match, quote: string, raw: string) => {
        const mapped = foldUrl(raw);
        return mapped ? `@import ${quote}${mapped}${quote}` : match;
      },
    );
    return out;
  }

  private async kickFetch(url: string, key: string): Promise<void> {
    const startMs = Date.now();
    let mode = 'cache';
    let bytes = 0;
    let ok = false;
    try {
      if (isPassThroughUrl(url)) {
        this.assets.registerPassThrough(key, url);
        mode = 'pass-through';
        ok = true;
        return;
      }
      const res = await this.page.context().request.get(url, { timeout: 10_000 });
      if (!res.ok()) return;
      const bufRaw = Buffer.from(await res.body());
      const headerCt = res.headers()['content-type'];
      let ct =
        (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim()
        || guessContentType(url)
        || 'application/octet-stream';
      let buf = bufRaw;
      if (ct.includes('text/css')) {
        const css = absolutizeCssUrls(bufRaw.toString('utf8'), url);
        const rewritten = rewriteCssUrlsToVirtual(css);
        buf = Buffer.from(rewritten, 'utf8');
      } else if (
        ct.includes('mpegurl')
        || ct.includes('dash+xml')
        || /\.m3u8(\?|$)/i.test(url)
        || /\.mpd(\?|$)/i.test(url)
      ) {
        buf = Buffer.from(rewriteManifestUrls(bufRaw.toString('utf8'), url), 'utf8');
        ct = ct.includes('dash') ? 'application/dash+xml' : 'application/vnd.apple.mpegurl';
      }
      bytes = buf.byteLength;
      ok = true;
      if (isPassThroughUrl(url, ct)) {
        mode = 'pass-through';
        this.assets.registerPassThrough(key, url, ct);
        // Still cache a copy when small enough for warm serve.
        this.assets.put(key, buf, ct, { sourceUrl: url, mode: 'pass-through' });
      } else {
        this.assets.put(key, buf, ct, { sourceUrl: url, mode: 'cache' });
      }
    } catch {
      /* optional */
    } finally {
      const durationMs = Date.now() - startMs;
      if (durationMs > 100) {
        this.emitParity('parity_asset_fetch_finished', {
          pageEpochId: this.pageEpochId ?? '',
          urlKey: urlKeyOf(url),
          durationMs,
          bytes,
          mode,
          ok,
          tVirtualMs: this.tVirtualMs(),
        });
      }
    }
  }

  private async rewriteRemoteAssets(
    nodes: DomNodeJson[],
    opts?: { deferFetches?: boolean },
  ): Promise<void> {
    type Candidate = { url: string; priority: number };
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    let bareSkipped = 0;
    let dataInlined = 0;
    let blobQueued = 0;
    let deferredFetches = 0;
    let rewritten = 0;
    let pageBase = 'https://invalid.local/';
    try {
      pageBase = this.page.url() || pageBase;
    } catch {
      /* */
    }

    const absolutize = (raw: string): string => {
      const t = raw.trim();
      if (!t || t.startsWith('/w7s/') || t.startsWith('data:') || t.startsWith('blob:')) return t;
      if (/^https?:\/\//i.test(t)) return t;
      try {
        return new URL(t, pageBase).href;
      } catch {
        return t;
      }
    };

    const consider = (
      raw: string | undefined,
      tag?: string,
      attrs?: Record<string, string>,
      attrName?: string,
    ) => {
      if (!raw || seen.has(raw)) return;
      if (raw.startsWith('/w7s/')) return;
      // Never virtualize document navigations — a stamped/unstamped virtual href
      // would navigate the Speculum Live SPA off the mirror (401 / white screen).
      if (attrName && isDocumentNavigationAttr(attrName, tag, attrs)) return;
      if (raw.startsWith('blob:') || raw.startsWith('data:')) {
        seen.add(raw);
        candidates.push({ url: raw, priority: 60 });
        return;
      }
      const url = absolutize(raw);
      if (seen.has(url)) return;
      if (!/^https?:\/\//i.test(url)) return;
      // Site-root / bare directory URLs are navigations, not fetchable assets.
      // Rewriting them to /w7s/virtual-assets/{host}/ yields 400/empty paint.
      if (isBareDocumentUrl(url)) {
        bareSkipped += 1;
        return;
      }
      seen.add(raw);
      seen.add(url);
      candidates.push({ url, priority: assetFetchPriority(url, tag, attrs) });
    };

    const walk = (node: DomNodeJson | undefined) => {
      if (!node) return;
      if (node.attrs) {
        for (const key of ['href', 'src', 'poster', 'srcset', 'imagesrcset', 'data-src', 'action', 'formaction'] as const) {
          const v = node.attrs[key];
          if (!v) continue;
          if (key === 'srcset' || key === 'imagesrcset') {
            for (const part of parseSrcset(v)) {
              consider(part.url, node.tag, node.attrs, key);
            }
          } else {
            consider(v, node.tag, node.attrs, key);
          }
        }
        if (node.attrs['style']) {
          for (const m of node.attrs['style'].matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) {
            consider(m[2], node.tag, node.attrs);
          }
        }
      }
      for (const child of node.children ?? []) walk(child);
    };

    for (const n of nodes) walk(n);

    const urlToVirtual = new Map<string, string>();
    for (const { url } of candidates) {
      if (url.startsWith('data:')) {
        const parsed = parseDataUrl(url);
        // Never invent /w7s/virtual-data/... without a successful ingest put.
        if (!parsed) continue;
        const id = createInlineId(url);
        this.assets.putData(id, parsed.body, parsed.contentType);
        urlToVirtual.set(url, VIRTUAL_DATA_PREFIX + id);
        dataInlined += 1;
        continue;
      }
      if (url.startsWith('blob:')) {
        const id = createInlineId(url);
        urlToVirtual.set(url, VIRTUAL_BLOB_PREFIX + id);
        void this.ingestBlob(url, id);
        blobQueued += 1;
        continue;
      }
      const key = virtualAssetKeyFromUrl(url);
      if (!key) continue;
      urlToVirtual.set(url, VIRTUAL_ASSETS_PREFIX + key);
    }

    // Also map original relative forms that absolutize to the same https URL.
    const rewriteLookup = (raw: string): string | undefined => {
      if (urlToVirtual.has(raw)) return urlToVirtual.get(raw);
      const abs = absolutize(raw);
      return urlToVirtual.get(abs);
    };

    candidates.sort((a, b) => b.priority - a.priority);
    const limited = candidates.slice(0, MAX_ASSET_FETCHES_PER_DIFF);
    const defer = opts?.deferFetches === true;
    const cssFetches: Promise<void>[] = [];
    const eagerImgFetches: Promise<void>[] = [];
    for (const { url, priority } of limited) {
      if (url.startsWith('data:') || url.startsWith('blob:')) continue;
      const key = virtualAssetKeyFromUrl(url);
      if (!key) continue;
      if (defer) {
        void this.kickFetch(url, key);
        deferredFetches += 1;
        continue;
      }
      // Stylesheets must land before Cssom install seeds from the cache (C6.5).
      if (priority >= 90) {
        cssFetches.push(this.kickFetch(url, key));
      } else if (priority >= 50 && eagerImgFetches.length < 8) {
        // Cap eager imgs so Dom establish stays responsive while chrome icons warm.
        eagerImgFetches.push(this.kickFetch(url, key));
      } else {
        void this.kickFetch(url, key);
      }
    }
    if (!defer && (cssFetches.length || eagerImgFetches.length)) {
      await Promise.all([...cssFetches, ...eagerImgFetches]);
    }

    if (urlToVirtual.size > 0) {
      const rewriteNode = (node: DomNodeJson | undefined) => {
        if (!node?.attrs) return;
        for (const key of Object.keys(node.attrs)) {
          const v = node.attrs[key];
          if (!v) continue;
          if (isDocumentNavigationAttr(key, node.tag, node.attrs)) continue;
          if (key === 'srcset' || key === 'imagesrcset') {
            node.attrs[key] = mapSrcset(v, (u) => rewriteLookup(u) ?? u);
            continue;
          }
          const mapped = rewriteLookup(v);
          if (mapped) {
            node.attrs[key] = mapped;
            rewritten += 1;
          }
          if (key === 'style') {
            node.attrs[key] = v.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, q, raw) => {
              const m = rewriteLookup(raw);
              if (m) rewritten += 1;
              return m ? `url(${q}${m}${q})` : full;
            });
          }
        }
        for (const child of node.children ?? []) rewriteNode(child);
      };

      for (const n of nodes) rewriteNode(n);
    }

    if (candidates.length > 0) {
      this.emitParity('parity_asset_rewrite_summary', {
        pageEpochId: this.pageEpochId ?? '',
        candidates: candidates.length,
        rewritten,
        bareSkipped,
        dataInlined,
        blobQueued,
        deferredFetches,
        tVirtualMs: this.tVirtualMs(),
      });
    }
  }

  private async ingestBlob(blobUrl: string, id: string): Promise<void> {
    try {
      const hit = await this.page.evaluate(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const ct = res.headers.get('content-type') || 'application/octet-stream';
          const buf = new Uint8Array(await res.arrayBuffer());
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < buf.length; i += chunk) {
            binary += String.fromCharCode(...buf.subarray(i, i + chunk));
          }
          return { contentType: ct, base64: btoa(binary) };
        } catch {
          return null;
        }
      }, blobUrl);
      if (!hit?.base64) return;
      this.assets.putBlob(id, Buffer.from(hit.base64, 'base64'), hit.contentType);
    } catch {
      /* optional */
    }
  }

  private push(
    plane: 'dom' | 'cssom',
    operation: string,
    payload: PageProjectionEmitPayload,
  ): void {
    if (this.sequenceGeneration !== this.generation) {
      this.sequenceGeneration = this.generation;
      this.sequence = 0;
    }
    this.sequence += 1;
    if (plane === 'dom') this.stampLmsInPayload(payload, this.sequence);
    this.events.onPageProjectionDiff({
      sequence: this.sequence,
      generation: this.generation,
      plane,
      operation,
      timestampMs: Date.now(),
      body: encodeDomBody(payload),
    });
  }
}

function createInlineId(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 24);
}

/** Parse DomMap evaluate result — prefers in-page `rootJson`/`sheetsJson` scalars. */
function parseMappedDomEvaluate(raw: Record<string, unknown> | null | undefined): ParsedDomMapEvaluate {
  if (!raw || typeof raw !== 'object') {
    return { root: null };
  }
  let root: DomNodeJson | null = null;
  const rootJson = raw.rootJson;
  if (typeof rootJson === 'string' && rootJson.length > 0) {
    try {
      const parsed = JSON.parse(rootJson) as DomNodeJson;
      if (parsed && typeof parsed === 'object' && typeof parsed.tag === 'string') root = parsed;
    } catch {
      root = null;
    }
  } else if (raw.root && typeof raw.root === 'object') {
    root = raw.root as DomNodeJson;
  }

  let sheets: unknown[] | undefined;
  const sheetsJson = raw.sheetsJson;
  if (typeof sheetsJson === 'string' && sheetsJson.length > 0) {
    try {
      const parsed = JSON.parse(sheetsJson) as unknown;
      if (Array.isArray(parsed)) sheets = parsed;
    } catch {
      sheets = undefined;
    }
  } else if (Array.isArray(raw.sheets)) {
    sheets = raw.sheets;
  }

  return {
    generation: typeof raw.generation === 'number' ? raw.generation : undefined,
    root,
    sheets,
    timings: (raw.timings && typeof raw.timings === 'object'
      ? (raw.timings as DomMapPhaseTimings)
      : undefined),
  };
}

type DomMirrorSelector = { kind?: string; query?: string; index?: number };

function unescapeCssAnchor(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

/** Extract `speculum-anchor` from a single `[speculum-anchor="…"]` segment. */
function anchorFromElementQuery(query: string): string | null {
  const m = /^\[speculum-anchor=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\]$/i.exec(query.trim());
  if (!m) return null;
  return unescapeCssAnchor(m[1] ?? m[2] ?? '');
}

function nodeAnchor(node: DomNodeJson): string | null {
  const a = node.anchor || node.attrs?.['speculum-anchor'];
  return typeof a === 'string' && a ? a : null;
}

function findDomMirrorByAnchor(root: DomNodeJson, anchor: string): DomNodeJson | null {
  if (!anchor) return null;
  if (nodeAnchor(root) === anchor) return root;
  for (const child of root.children ?? []) {
    const hit = findDomMirrorByAnchor(child, anchor);
    if (hit) return hit;
  }
  return null;
}

function findDomMirrorByTag(root: DomNodeJson, tag: string): DomNodeJson | null {
  const want = tag.toLowerCase();
  if ((root.tag || '').toLowerCase() === want) return root;
  for (const child of root.children ?? []) {
    if (child.tag === '#text' || child.tag === '#comment') continue;
    const hit = findDomMirrorByTag(child, want);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve wire `query` against DomNodeJson — supports
 * `[speculum-anchor="…"]` and compound `… > :nth-child(n)` (element-only steps),
 * plus legacy `html|body|head` roots.
 */
function resolveDomMirrorQuery(root: DomNodeJson, query: string): DomNodeJson | null {
  const parts = query
    .split(/\s*>\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const first = parts[0];
  let cur: DomNodeJson | null = null;
  const firstAnchor = anchorFromElementQuery(first);
  if (firstAnchor) {
    cur = findDomMirrorByAnchor(root, firstAnchor);
  } else if (/^(html|body|head)$/i.test(first)) {
    cur = findDomMirrorByTag(root, first);
  } else {
    return null;
  }
  if (!cur) return null;

  for (let i = 1; i < parts.length; i++) {
    const step = parts[i];
    const m = /^:nth-child\((\d+)\)$/i.exec(step);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1) return null;
    // Writer nth-child space = F element siblings only (skip text/comment).
    let seen = 0;
    let hit: DomNodeJson | null = null;
    const kids: DomNodeJson[] = cur.children ?? [];
    for (const child of kids) {
      if (child.tag === '#text' || child.tag === '#comment') continue;
      seen += 1;
      if (seen === n) {
        hit = child;
        break;
      }
    }
    if (!hit) return null;
    cur = hit;
  }
  return cur;
}

function resolveDomMirrorParent(
  root: DomNodeJson,
  selector: DomMirrorSelector | undefined,
): DomNodeJson | null {
  if (!selector || typeof selector.query !== 'string') return null;
  const kind = selector.kind === 'childAt' ? 'childAt' : 'element';
  const el = resolveDomMirrorQuery(root, selector.query);
  if (!el) return null;
  if (kind === 'element') return el;
  const index = Number(selector.index);
  if (!Number.isFinite(index) || index < 0) return null;
  const kids = el.children ?? [];
  return kids[index] ?? null;
}

function applyDomMirrorChildList(
  root: DomNodeJson,
  payload: PageProjectionEmitPayload,
): { ok: true } | { ok: false; reason: string } {
  const selector = payload.selector as DomMirrorSelector | undefined;
  const parent = resolveDomMirrorParent(root, {
    kind: 'element',
    query: typeof selector?.query === 'string' ? selector.query : undefined,
  });
  if (!parent || typeof parent.tag !== 'string' || parent.tag === '#text' || parent.tag === '#comment') {
    return { ok: false, reason: 'parent_miss' };
  }
  if (!Array.isArray(parent.children)) parent.children = [];

  const removed = Array.isArray(payload.removed)
    ? (payload.removed as Array<{ selector?: DomMirrorSelector }>)
    : [];
  const removeIndexes = new Set<number>();
  for (const entry of removed) {
    const sel = entry?.selector;
    if (!sel || typeof sel.query !== 'string') continue;
    if (sel.kind === 'childAt') {
      const idx = Number(sel.index);
      // Soft-skip oob removes (mirror shorter than live F-space) — keep mirror hot.
      if (!Number.isFinite(idx) || idx < 0 || idx >= parent.children.length) continue;
      removeIndexes.add(idx);
      continue;
    }
    const target = resolveDomMirrorQuery(root, sel.query);
    if (!target) continue; // already absent in mirror
    const idx = parent.children.indexOf(target);
    if (idx < 0) {
      // Present elsewhere under root but not as direct F-child — structural drift.
      return { ok: false, reason: `removed_not_direct_child:${sel.query.slice(0, 80)}` };
    }
    removeIndexes.add(idx);
  }

  const added = Array.isArray(payload.added)
    ? [...(payload.added as Array<{ index?: number; node?: DomNodeJson }>)].sort(
        (a, b) => Number(a.index) - Number(b.index),
      )
    : [];
  for (const entry of added) {
    if (!entry?.node || typeof entry.node !== 'object') {
      return { ok: false, reason: 'added_bad_node' };
    }
  }

  const sortedRemove = [...removeIndexes].sort((a, b) => b - a);
  for (const idx of sortedRemove) {
    if (idx < 0 || idx >= parent.children.length) continue;
    parent.children.splice(idx, 1);
  }
  for (const entry of added) {
    let idx = Number(entry.index);
    if (!Number.isFinite(idx) || idx < 0) idx = parent.children.length;
    if (idx > parent.children.length) idx = parent.children.length;
    parent.children.splice(idx, 0, structuredClone(entry.node as DomNodeJson));
  }
  return { ok: true };
}

function applyDomMirrorPatch(root: DomNodeJson, payload: PageProjectionEmitPayload): boolean {
  const selector = payload.selector as DomMirrorSelector | undefined;
  const node = payload.node as DomNodeJson | undefined;
  if (!node || typeof node !== 'object') return false;
  if (!selector || typeof selector.query !== 'string') return false;

  if (selector.kind === 'childAt') {
    const parent = resolveDomMirrorQuery(root, selector.query);
    if (!parent) return false;
    const idx = Number(selector.index);
    if (!Number.isFinite(idx) || idx < 0 || !parent.children || idx >= parent.children.length) {
      return false;
    }
    const target = parent.children[idx];
    if (target.tag === '#text' || target.tag === '#comment' || node.tag === '#text' || node.tag === '#comment') {
      parent.children[idx] = {
        tag: typeof node.tag === 'string' ? node.tag : target.tag,
        text: typeof node.text === 'string' ? node.text : '',
      };
      return true;
    }
    return false;
  }

  const target = resolveDomMirrorQuery(root, selector.query);
  if (!target) return false;
  if (typeof node.tag === 'string' && node.tag) target.tag = node.tag;
  if (node.attrs && typeof node.attrs === 'object') {
    target.attrs = { ...node.attrs };
  }
  if (typeof node.anchor === 'string') target.anchor = node.anchor;
  if (typeof node.text === 'string') target.text = node.text;
  return true;
}

function safePageUrl(page: Page): string | undefined {
  try {
    return page.url();
  } catch {
    return undefined;
  }
}

type CssomMirrorSheet = {
  id?: string;
  rules?: Array<{ id?: string; cssText?: string }>;
  scope?: { kind?: string; hostAnchor?: string };
  [key: string]: unknown;
};

function parseDataUrl(url: string): { body: Buffer; contentType: string } | null {
  if (typeof url !== 'string' || !url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma < 5) return null;
  const meta = url.slice(5, comma);
  const data = url.slice(comma + 1);
  const parts = meta.split(';').map((p) => p.trim()).filter(Boolean);
  const typePart = parts.find((p) => p.includes('/'));
  const contentType = typePart || 'application/octet-stream';
  const b64 = parts.some((p) => p.toLowerCase() === 'base64');
  try {
    const body = b64
      ? Buffer.from(data.replace(/\s/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(data), 'utf8');
    // Reject base64 that decoded to empty while the payload was non-empty (corrupt).
    if (b64 && data.replace(/\s/g, '').length > 0 && body.length === 0) return null;
    return { body, contentType };
  } catch {
    return null;
  }
}

/** Exported for unit effect asserts (ingest gate for virtual-data). */
export { parseDataUrl };

function rewriteCssUrlsToVirtual(css: string): string {
  let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/')) return match;
    if (!/^https?:\/\//i.test(trimmed)) return match;
    if (isBareDocumentUrl(trimmed)) return match;
    const key = virtualAssetKeyFromUrl(trimmed);
    if (!key) return match;
    return `url(${quote}${VIRTUAL_ASSETS_PREFIX}${key}${quote})`;
  });
  out = out.replace(
    /@import\s+(?!url\()(['"])([^'"]+)\1/gi,
    (match, quote: string, raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/')) return match;
      if (!/^https?:\/\//i.test(trimmed)) return match;
      if (isBareDocumentUrl(trimmed)) return match;
      const key = virtualAssetKeyFromUrl(trimmed);
      if (!key) return match;
      return `@import ${quote}${VIRTUAL_ASSETS_PREFIX}${key}${quote}`;
    },
  );
  return out;
}

/** True for attrs that navigate the browsing context (must stay absolute https). */
function isDocumentNavigationAttr(
  attrName: string,
  tag: string | undefined,
  attrs: Record<string, string> | undefined,
): boolean {
  const key = attrName.toLowerCase();
  if (key === 'action' || key === 'formaction') return true;
  if (key !== 'href') return false;
  const t = (tag ?? '').toLowerCase();
  if (t === 'a' || t === 'area') return true;
  if (t === 'link') {
    const rel = (attrs?.rel ?? '').toLowerCase();
    // Asset-like link rels stay virtualized.
    if (
      rel.includes('stylesheet')
      || rel.includes('icon')
      || rel.includes('preload')
      || rel.includes('modulepreload')
      || rel.includes('manifest')
      || rel.includes('apple-touch-icon')
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/** Origin root or trailing-slash path with no asset extension — do not virtualize. */
function isBareDocumentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const p = u.pathname || '/';
    if (p === '/') return true;
    if (!p.endsWith('/')) return false;
    return !/\.[a-z0-9]{1,8}\//i.test(p);
  } catch {
    return false;
  }
}

function rewriteManifestUrls(body: string, baseUrl: string): string {
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        // Rewrite URI="..." inside HLS tags.
        return line.replace(/URI="([^"]+)"/gi, (_m, raw: string) => {
          try {
            const abs = new URL(raw, baseUrl).href;
            const key = virtualAssetKeyFromUrl(abs);
            return key ? `URI="${VIRTUAL_ASSETS_PREFIX}${key}"` : _m;
          } catch {
            return _m;
          }
        });
      }
      try {
        const abs = new URL(trimmed, baseUrl).href;
        const key = virtualAssetKeyFromUrl(abs);
        return key ? `${VIRTUAL_ASSETS_PREFIX}${key}` : line;
      } catch {
        return line;
      }
    })
    .join('\n');
}

function assetFetchPriority(
  url: string,
  tag: string | undefined,
  attrs: Record<string, string> | undefined,
): number {
  const rel = (attrs?.rel ?? '').toLowerCase();
  if (tag === 'link' && (rel.includes('stylesheet') || /\.css(\?|$)/i.test(url))) return 100;
  if (/\.css(\?|$)/i.test(url)) return 90;
  if (tag === 'img') return 50;
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) return 40;
  if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url)) return 20;
  if (isPassThroughUrl(url)) return 30;
  return 10;
}

function absolutizeCssUrls(css: string, baseUrl: string): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (
      !trimmed
      || trimmed.startsWith('data:')
      || trimmed.startsWith('http://')
      || trimmed.startsWith('https://')
      || trimmed.startsWith('/w7s/')
    ) {
      return match;
    }
    try {
      return `url(${quote}${new URL(trimmed, baseUrl).href}${quote})`;
    } catch {
      return match;
    }
  });
}

function guessContentType(url: string): string | null {
  const path = url.split('?')[0]!.toLowerCase();
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.woff')) return 'font/woff';
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  return null;
}

type CdpDomNode = {
  nodeId?: number;
  shadowRootType?: string;
  shadowRoots?: CdpDomNode[];
  children?: CdpDomNode[];
  contentDocument?: CdpDomNode;
};

function walkCdpClosedShadows(
  node: CdpDomNode,
  out: Array<{ hostId: number; shadowId: number }>,
): void {
  const hostId = node.nodeId;
  if (hostId != null && Array.isArray(node.shadowRoots)) {
    for (const sr of node.shadowRoots) {
      if (sr.shadowRootType === 'closed' && sr.nodeId != null) {
        out.push({ hostId, shadowId: sr.nodeId });
      }
      walkCdpClosedShadows(sr, out);
    }
  }
  if (node.contentDocument) walkCdpClosedShadows(node.contentDocument, out);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkCdpClosedShadows(child, out);
  }
}

/** Optional CDP Fetch hook — do not enable alongside Navigation Fetch.guard. */
export async function attachDomAssetFetch(
  cdp: CDPSession,
  _put: (body: Buffer, contentType: string) => string | null,
): Promise<() => Promise<void>> {
  return async () => {
    void cdp;
  };
}
