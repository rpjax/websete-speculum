import { createHash } from 'node:crypto';
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
};

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
   * Sidecar gate for page live emits (T10). Armed only after Dom `document` +
   * Cssom `install` have been materializeAndPush'd on this epoch.
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

  private constructor(
    private readonly page: Page,
    private readonly events: PageProjectionEvents,
  ) {}

  static async start(page: Page, events: PageProjectionEvents): Promise<PageProjection> {
    const proj = new PageProjection(page, events);
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
    // D4 single boot epoch: install observers only — first establish waits for
    // establishBoot() after the session's initial navigation settles.
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
   * First Dom `document` + Cssom `install` for the session (D4 / C4).
   * Idempotent — safe to call from navigate settle and from late framenavigated.
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
      await this.page.evaluate(
        `typeof window.__speculumDomBumpGeneration === "function" && window.__speculumDomBumpGeneration(1)`,
      );
      await this.ensureClosedShadowPierce();
      // T10: established only after document + install are on the chain (not before).
      const armed = await this.enqueueDocumentDiff();
      if (armed) this.established = true;
    } catch {
      /* mid-navigation */
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
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
      // Sidecar owns monotonic generation — never adopt a fresh page counter (T3).
      const fromGeneration = this.generation;
      this.generation += 1;
      await this.page.evaluate(
        `typeof window.__speculumDomBumpGeneration === "function" && window.__speculumDomBumpGeneration(${this.generation})`,
      );
      await this.ensureClosedShadowPierce();
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
   * Live pipe continues with its own chronology; client applies this watermarked body.
   * Capture runs on `materializeChain` so live `push` cannot interleave (truthful watermark).
   */
  async captureResyncSnapshot(): Promise<{
    generation: number;
    coversThroughSequence: number;
    root: DomNodeJson;
    sheets: unknown[];
  } | null> {
    if (this.stopped) return null;
    // Pre-establish resync would invent watermark 0 — refuse (T8 / T10).
    if (!this.established) return null;
    return this.runOnMaterializeChain(async () => {
      try {
        // Do not waitStylesheetsReady here — holding the chain for seconds lets
        // Virtual mutate while emits queue, then clients storm-resync (T8).
        // MapDocument takes MO records + resets publishedAnchors to the snapshot.
        const mapped = (await this.page.evaluate('window.__speculumDomMapDocument()')) as {
          generation?: number;
          root: DomNodeJson;
        };
        if (!mapped?.root) return null;
        // Generation SoT is the sidecar counter — do not adopt a reset page value.
        await this.rewriteRemoteAssets([mapped.root]);

        const cssom = (await this.page.evaluate('window.__speculumDomMapCssom()')) as {
          sheets?: unknown[];
        };
        const sheets: unknown[] = Array.isArray(cssom?.sheets) ? [...cssom.sheets] : [];
        // C7/C8: joint resync must include XO pierce-scoped sheets (top map cannot see them).
        for (const [hostAnchor, frame] of this.chromiumPierceByAnchor) {
          if (this.stopped) break;
          try {
            if (frame.isDetached()) {
              this.chromiumPierceByAnchor.delete(hostAnchor);
              continue;
            }
            const pierceSheets = (await frame.evaluate(
              `typeof window.__speculumDomMapPierceCssom === "function" ? window.__speculumDomMapPierceCssom() : []`,
            )) as unknown;
            if (Array.isArray(pierceSheets)) sheets.push(...pierceSheets);
          } catch {
            /* frame gone mid-resync */
          }
        }
        await this.seedCssomSheets('install', { sheets });
        this.rewriteCssomPayload('install', { sheets });

        return {
          generation: this.generation,
          // Watermark after map+seed under the same chain turn — no concurrent push.
          coversThroughSequence: this.sequence,
          root: mapped.root,
          sheets,
        };
      } catch {
        return null;
      }
    });
  }

  /**
   * @deprecated Does not publish OOB resync. Use `captureResyncSnapshot` and the
   * Watch/GetPageProjectionResync transport (T8).
   */
  async requestResync(): Promise<{
    generation: number;
    coversThroughSequence: number;
    root: DomNodeJson;
    sheets: unknown[];
  } | null> {
    if (this.stopped) return null;
    return this.captureResyncSnapshot();
  }

  getGeneration(): number {
    return this.generation;
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
  private async waitStylesheetsReady(timeoutMs: number): Promise<void> {
    try {
      await this.page.evaluate(
        `typeof window.__speculumDomWaitStylesheetsReady === "function"
          ? window.__speculumDomWaitStylesheetsReady(${Math.max(0, timeoutMs | 0)})
          : null`,
      );
    } catch {
      /* mid-navigation */
    }
  }

  /**
   * Map Dom `document` + Cssom `install` and arm page live emit in one evaluate,
   * then push both planes. Sidecar `liveArmed` is set before push so MO that fires
   * during materialize enqueues behind document/install on the chain (T10).
   */
  private enqueueDocumentDiff(): Promise<boolean> {
    return new Promise((resolve) => {
      this.enqueue(async () => {
        let armed = false;
        try {
          this.liveArmed = false;
          // C4: wait styles before Dom document so the first client paint is not a
          // long FOUC window ahead of Cssom install.
          await this.waitStylesheetsReady(2500);
          const mapped = (await this.page.evaluate(
            `typeof window.__speculumDomMapAndArmEstablish === "function"
              ? window.__speculumDomMapAndArmEstablish()
              : null`,
          )) as {
            generation?: number;
            root?: DomNodeJson;
            sheets?: unknown[];
          } | null;
          if (!mapped?.root) return;
          // Accept page MO immediately; emitFromPage enqueues behind this task.
          this.liveArmed = true;
          await this.materializeAndPush('dom', 'document', { root: mapped.root });
          if (Array.isArray(mapped.sheets)) {
            await this.materializeAndPush('cssom', 'install', { sheets: mapped.sheets });
          }
          armed = true;
        } catch {
          this.liveArmed = false;
        } finally {
          resolve(armed);
        }
      });
    });
  }

  private emitFromPage(emitted: unknown): void {
    // T10: drop live page traffic until document + install armed this epoch.
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
      if (operation === 'sheetList') this.noteCssomSheetList(payload);
    }
    if (this.stopped) return;
    this.push(plane, operation, payload);
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
    try {
      if (isPassThroughUrl(url)) {
        this.assets.registerPassThrough(key, url);
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
      if (isPassThroughUrl(url, ct)) {
        this.assets.registerPassThrough(key, url, ct);
        // Still cache a copy when small enough for warm serve.
        this.assets.put(key, buf, ct, { sourceUrl: url, mode: 'pass-through' });
      } else {
        this.assets.put(key, buf, ct, { sourceUrl: url, mode: 'cache' });
      }
    } catch {
      /* optional */
    }
  }

  private async rewriteRemoteAssets(nodes: DomNodeJson[]): Promise<void> {
    type Candidate = { url: string; priority: number };
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
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
      seen.add(raw);
      seen.add(url);
      candidates.push({ url, priority: assetFetchPriority(url, tag, attrs) });
    };

    const walk = (node: DomNodeJson | undefined) => {
      if (!node) return;
      if (node.attrs) {
        for (const key of ['href', 'src', 'poster', 'srcset', 'data-src', 'action', 'formaction'] as const) {
          const v = node.attrs[key];
          if (!v) continue;
          if (key === 'srcset') {
            for (const part of v.split(',')) {
              const u = part.trim().split(/\s+/)[0];
              consider(u, node.tag, node.attrs, key);
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
        const id = createInlineId(url);
        const parsed = parseDataUrl(url);
        if (parsed) {
          this.assets.putData(id, parsed.body, parsed.contentType);
        }
        urlToVirtual.set(url, VIRTUAL_DATA_PREFIX + id);
        continue;
      }
      if (url.startsWith('blob:')) {
        const id = createInlineId(url);
        urlToVirtual.set(url, VIRTUAL_BLOB_PREFIX + id);
        void this.ingestBlob(url, id);
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
    const cssFetches: Promise<void>[] = [];
    const otherFetches: Array<{ url: string; key: string }> = [];
    for (const { url } of limited) {
      if (url.startsWith('data:') || url.startsWith('blob:')) continue;
      const key = virtualAssetKeyFromUrl(url);
      if (!key) continue;
      // Stylesheets must land before Cssom install seeds from the cache (C6.5).
      if (/\.css(\?|$)/i.test(url) || assetFetchPriority(url, undefined, undefined) >= 90) {
        cssFetches.push(this.kickFetch(url, key));
      } else {
        otherFetches.push({ url, key });
      }
    }
    if (cssFetches.length) await Promise.all(cssFetches);
    for (const { url, key } of otherFetches) {
      void this.kickFetch(url, key);
    }

    if (urlToVirtual.size === 0) return;

    const rewriteNode = (node: DomNodeJson | undefined) => {
      if (!node?.attrs) return;
      for (const key of Object.keys(node.attrs)) {
        const v = node.attrs[key];
        if (!v) continue;
        if (isDocumentNavigationAttr(key, node.tag, node.attrs)) continue;
        if (key === 'srcset') {
          node.attrs[key] = v
            .split(',')
            .map((part) => {
              const bits = part.trim().split(/\s+/);
              const u = bits[0]!;
              const mapped = rewriteLookup(u);
              if (mapped) bits[0] = mapped;
              return bits.join(' ');
            })
            .join(', ');
          continue;
        }
        const mapped = rewriteLookup(v);
        if (mapped) node.attrs[key] = mapped;
        if (key === 'style') {
          node.attrs[key] = v.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, q, raw) => {
            const m = rewriteLookup(raw);
            return m ? `url(${q}${m}${q})` : full;
          });
        }
      }
      for (const child of node.children ?? []) rewriteNode(child);
    };

    for (const n of nodes) rewriteNode(n);
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

function parseDataUrl(url: string): { body: Buffer; contentType: string } | null {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!m) return null;
  const contentType = m[1] || 'application/octet-stream';
  const b64 = !!m[2];
  const data = m[3] ?? '';
  try {
    const body = b64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
    return { body, contentType };
  } catch {
    return null;
  }
}

function rewriteCssUrlsToVirtual(css: string): string {
  let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/')) return match;
    if (!/^https?:\/\//i.test(trimmed)) return match;
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
