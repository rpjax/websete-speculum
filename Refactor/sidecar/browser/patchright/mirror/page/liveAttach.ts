import type { Page, CDPSession, Frame } from 'patchright';
import { DomAssetCache, type DomAssetShareability } from '../dom/DomAssetCache';
import { PageProjectionEngine } from './PageProjection';
import { createDirtyState, type DirtyState } from './observe';
import {
  extractDocumentState,
  type DocumentLike,
} from './fmap';
import type { EncodedFrameMeta } from './encode';
import { ESTABLISH_CHUNK_BYTES_DEFAULT } from './establish';
import {
  captureMirrorResyncSnapshot,
  orchestrateLiveEstablish,
} from './establishLive';
import { absorbCssomDelta, type RawCssomDelta } from './cssomLive';
import { NodeMirror } from './node/mirror';
import { UrlRewriter } from './node/rewrite';
import { AssetPriorityQueue } from './assetPriority';
import { waitVirtualDocumentReady as waitDocumentReadyFn } from './documentReady';
import {
  SnapshotTreeQuery,
  type LiveNode,
} from './snapshotTreeQuery';
import {
  adoptClosedShadowsWithParity,
  attachLiveCdpSession,
  handleLiveMainFrameNavigated,
  safeHost,
  snapshotDocumentRaw,
  installLivePageScript,
  bridgeLiveOnFrame,
} from './cdpLive';
import {
  fetchPassThroughAsset,
  scheduleAssetPrefetch,
} from './assetsLive';
import {
  absorbDirtyFromTick,
  applyClientStateReport,
  attachVirtualTelemetry,
  buildLiveEngineEvents,
  buildLiveScheduler,
  detachVirtualTelemetry,
  emitFrameAggregateParity,
  emitPageProjectionParts,
  mintLivePageEpoch,
  runLiveSchedulerTick,
  type LiveFrameStats,
} from './emitLive';

import {
  type LivePageProjectionEvents,
  type LivePageProjectionNavigationType,
  type LivePageProjectionStartOptions,
} from './liveTypes';

export type {
  LivePageProjectionEvents,
  LivePageProjectionNavigationType,
  LivePageProjectionStartOptions,
} from './liveTypes';

/**
 * Live V2 producer on a real `Page`. Owns `PageProjectionEngine`, snapshot cache,
 * asset cache, PageEpoch telemetry, and CDP pierce. §5.5 binary parts go to
 * `onPageProjectionDiff` with empty plane/operation — no JSON→binary adapter.
 * Sensors: Cssom, open+closed shadow, same-origin/XO iframe pierce, scroll/media/
 * DocumentState, soft-nav (PP-NAV-2).
 */
export class LivePageProjection {
  private stopped = false;
  private established = false;
  private establishInFlight: Promise<void> | null = null;
  private establishRetryScheduled = false;
  private schedulerStarted = false;
  private busy = false;
  private pendingDirty: DirtyState = createDirtyState();
  private hasPending = false;
  private pendingNav: LivePageProjectionNavigationType | null = null;
  private engine!: PageProjectionEngine<LiveNode>;
  private readonly treeQuery: SnapshotTreeQuery;
  private readonly mirrorBox: { mirror: NodeMirror | null } = { mirror: null };
  private readonly rewriterBox: { current: UrlRewriter };
  private assets: DomAssetCache = new DomAssetCache();
  private readonly uploads = new Map<string, { body: Buffer; contentType: string; name: string }>();
  private stallWatchdog: ReturnType<typeof setInterval> | null = null;
  private aggregateTimer: ReturnType<typeof setInterval> | null = null;
  private establishChunkBytes = ESTABLISH_CHUNK_BYTES_DEFAULT;
  private mirrorMaxBytes = 32 * 1024 * 1024;
  private assetPriorityViewportPx = 200;
  private aggregateIntervalMs = 10_000;
  private frameStallMs = 1000;
  private pageEpochId = '';
  private pageEpochCommitAtMs = 0;
  private tVirtualStartMs = 0;
  private virtualDetachers: Array<() => void> = [];
  private readonly frameStats: LiveFrameStats = {
    framesEmitted: 0,
    bytesEmitted: 0,
    lastRateHz: 0,
    stallCount: 0,
    applyOverrunReports: 0,
  };
  /** CDP session shared for soft-nav (PP-NAV-2) and closed-shadow / XO pierce (PP-F-4). */
  private cdp: CDPSession | null = null;
  private mainFrameCdpId: string | null = null;
  private softNavEpoch: string | null = null;
  private documentEpoch: string | null = null;
  /** Absolute URL → whether the site's own request carried Authorization (Network). */
  private readonly authByUrl = new Map<string, boolean>();
  private readonly xoIdMaps = new Map<Frame, Map<number, number>>();
  private readonly xoFrameByIframeId = new Map<number, Frame>();
  private assetQueue = new AssetPriorityQueue(200);

  private constructor(
    private readonly page: Page,
    private readonly events: LivePageProjectionEvents,
  ) {
    this.rewriterBox = { current: new UrlRewriter({ originHost: safeHost(page.url()) }) };
    this.treeQuery = new SnapshotTreeQuery(this.mirrorBox, this.rewriterBox);
  }

  static async start(
    page: Page,
    events: LivePageProjectionEvents,
    opts?: LivePageProjectionStartOptions,
  ): Promise<LivePageProjection> {
    const proj = new LivePageProjection(page, events);
    proj.tVirtualStartMs = opts?.browserLaunchedAtMs ?? Date.now();
    if (opts?.establishChunkBytes) proj.establishChunkBytes = opts.establishChunkBytes;
    if (opts?.mirrorMaxBytes) proj.mirrorMaxBytes = opts.mirrorMaxBytes;
    if (opts?.assetPriorityViewportPx) proj.assetPriorityViewportPx = opts.assetPriorityViewportPx;
    if (opts?.aggregateIntervalMs) proj.aggregateIntervalMs = opts.aggregateIntervalMs;
    if (opts?.frameStallMs && opts.frameStallMs > 0) proj.frameStallMs = opts.frameStallMs;
    proj.assetQueue = new AssetPriorityQueue(proj.assetPriorityViewportPx);
    if (opts?.assetCacheL1MaxBytes && opts.assetCacheL1MaxBytes > 0) {
      proj.assets = new DomAssetCache(opts.assetCacheL1MaxBytes);
    }
    await page.exposeBinding('__speculumPPv2Tick', async (_source, tick) => {
      if (proj.stopped) return;
      await proj.absorbRawTick(tick);
    });
    proj.engine = new PageProjectionEngine<LiveNode>({
      events: buildLiveEngineEvents({
        emitParts: (parts, meta) => proj.emitParts(parts, meta),
        onGenerationBumped: events.onGenerationBumped,
        frameStats: proj.frameStats,
        onParity: events.onParity,
        getPageEpochId: () => proj.pageEpochId,
        getGeneration: () => proj.engine.currentGeneration,
      }),
      scheduler: buildLiveScheduler({
        onSchedulerTick: (tick) => proj.onSchedulerTick(tick),
      }),
      channel: { push: () => {} },
      treeQuery: proj.treeQuery,
      originHost: safeHost(page.url()),
      frameRateHz: opts?.frameRateHz,
      maxFrameBytes: opts?.maxFrameBytes,
      hiddenRateHz: opts?.hiddenRateHz,
      rateRecoverMs: opts?.rateRecoverMs,
      frameStallMs: proj.frameStallMs,
      rateLadder: opts?.rateLadder,
    });
    proj.mirrorBox.mirror = proj.engine.mirror;
    await installLivePageScript(page);
    await bridgeLiveOnFrame(page);
    await proj.ensureCdpSession();
    page.on('request', (req) => {
      try {
        const headers = req.headers();
        const hasAuth = Boolean(headers['authorization'] || headers['Authorization']);
        if (hasAuth) proj.authByUrl.set(req.url(), true);
      } catch {
        /* ignore */
      }
    });
    page.on('framenavigated', (frame) => {
      if (proj.stopped) return;
      if (frame === page.mainFrame()) void proj.onMainFrameNavigated();
      else void proj.onChildFrameNavigated(frame);
    });
    proj.stallWatchdog = setInterval(() => {
      if (!proj.stopped) proj.engine.checkClockStall();
    }, Math.max(50, Math.min(proj.frameStallMs, 500)));
    proj.aggregateTimer = setInterval(() => {
      if (!proj.stopped) proj.emitFrameAggregate();
    }, Math.max(1000, proj.aggregateIntervalMs));
    return proj;
  }

  private async onSchedulerTick(tick: () => void): Promise<void> {
    await runLiveSchedulerTick({
      state: {
        stopped: this.stopped,
        busy: this.busy,
        hasPending: this.hasPending,
        established: this.established,
      },
      setBusy: (busy) => { this.busy = busy; },
      pollAndIngest: () => this.pollAndIngest(),
      tick,
    });
  }

  private async pollAndIngest(): Promise<void> {
    const dirty = this.pendingDirty;
    this.pendingDirty = createDirtyState();
    this.hasPending = false;
    const raw = await snapshotDocumentRaw({
      page: this.page,
      cdp: this.cdp,
      xoIdMaps: this.xoIdMaps,
      xoFrameByIframeId: this.xoFrameByIframeId,
    });
    if (!raw) return;
    this.treeQuery.load(raw);
    this.engine.ingestDirty(dirty);
  }

  private async onChildFrameNavigated(frame: Frame): Promise<void> {
    if (this.stopped || frame === this.page.mainFrame()) return;
    for (const [iframeId, tracked] of this.xoFrameByIframeId) {
      if (tracked === frame) {
        this.hasPending = true;
        void iframeId;
        return;
      }
    }
  }

  private async absorbRawTick(tick: unknown): Promise<void> {
    if (this.stopped || !tick || typeof tick !== 'object') return;
    const t = tick as {
      dirty?: Record<string, number[]> & { scrollDirty?: [number, number, number][] };
      cssom?: RawCssomDelta[] | null;
      documentState?: DocumentLike | null;
    };
    if (absorbDirtyFromTick(this.pendingDirty, t.dirty)) this.hasPending = true;
    // Cssom and DocumentState never depend on the raw-tree poll — feed the engine straight away.
    for (const delta of t.cssom ?? []) {
      await absorbCssomDelta(this.engine.cssom, this.cdp, delta, this.rewriterBox.current);
    }
    if (t.documentState) this.engine.noteDocumentState({ op: 'documentState', ...extractDocumentState(t.documentState) });
  }

  private async ensureCdpSession(): Promise<void> {
    await attachLiveCdpSession({
      page: this.page,
      cdp: this.cdp,
      isStopped: () => this.stopped,
      getMainFrameCdpId: () => this.mainFrameCdpId,
      setMainFrameCdpId: (id) => { this.mainFrameCdpId = id; },
      setCdp: (cdp) => { this.cdp = cdp; },
      softNav: {
        mintPageEpoch: (args) => this.mintPageEpoch(args),
        onSoftNavObserved: this.events.onSoftNavObserved,
        getGeneration: () => this.engine?.currentGeneration ?? 1,
        isLiveArmed: () => this.established,
        setSoftNavEpoch: (epoch) => { this.softNavEpoch = epoch; },
      },
      onShadowAdopted: () => { this.hasPending = true; },
      adoptClosedShadows: () => this.adoptClosedShadowsFromCdp(),
    });
  }

  private async adoptClosedShadowsFromCdp(): Promise<void> {
    await adoptClosedShadowsWithParity({
      cdp: this.cdp,
      isStopped: () => this.stopped,
      pageEpochId: this.pageEpochId,
      generation: this.engine?.currentGeneration ?? 1,
      onParity: this.events.onParity,
    });
  }

  private mintPageEpoch(args: { soft: boolean; documentEpoch?: string | null }): void {
    const minted = mintLivePageEpoch({
      page: this.page,
      soft: args.soft,
      documentEpoch: args.documentEpoch ?? this.documentEpoch,
      generation: this.engine?.currentGeneration ?? 1,
      tVirtualStartMs: this.tVirtualStartMs,
      onParity: this.events.onParity,
      detachVirtualTelemetry: () => this.detachVirtualTelemetry(),
      attachVirtualTelemetry: () => this.attachVirtualTelemetry(),
    });
    this.pageEpochId = minted.pageEpochId;
    this.pageEpochCommitAtMs = minted.pageEpochCommitAtMs;
  }

  private tVirtualMs(): number {
    return Date.now() - this.tVirtualStartMs;
  }

  private detachVirtualTelemetry(): void {
    detachVirtualTelemetry(this.virtualDetachers);
  }

  private attachVirtualTelemetry(): void {
    attachVirtualTelemetry({
      page: this.page,
      stopped: () => this.stopped,
      pageEpochId: this.pageEpochId,
      pageEpochCommitAtMs: this.pageEpochCommitAtMs,
      tVirtualStartMs: this.tVirtualStartMs,
      getPageEpochId: () => this.pageEpochId,
      onParity: this.events.onParity,
      pushDetacher: (d) => this.virtualDetachers.push(d),
    });
  }

  private emitFrameAggregate(): void {
    emitFrameAggregateParity({
      onParity: this.events.onParity,
      pageEpochId: this.pageEpochId,
      generation: this.engine?.currentGeneration ?? 1,
      frameStats: this.frameStats,
      rateHz: this.engine?.rateHz ?? this.frameStats.lastRateHz,
      mirrorBytes: this.mirrorBox.mirror?.estimateBytes?.() ?? this.mirrorBox.mirror?.size ?? 0,
      aggregateIntervalMs: this.aggregateIntervalMs,
      tVirtualMs: this.tVirtualMs(),
    });
  }

  private async onMainFrameNavigated(): Promise<void> {
    await handleLiveMainFrameNavigated({
      page: this.page,
      isStopped: () => this.stopped,
      getSoftNavEpoch: () => this.softNavEpoch,
      setSoftNavEpoch: (epoch) => { this.softNavEpoch = epoch; },
      getDocumentEpoch: () => this.documentEpoch,
      setDocumentEpoch: (epoch) => { this.documentEpoch = epoch; },
      getPageEpochId: () => this.pageEpochId,
      isEstablished: () => this.established,
      getGeneration: () => this.engine.currentGeneration,
      mintPageEpoch: (args) => this.mintPageEpoch(args),
      onSoftNavObserved: this.events.onSoftNavObserved,
      ensureCdpSession: () => this.ensureCdpSession(),
      adoptClosedShadows: () => this.adoptClosedShadowsFromCdp(),
      runEstablish: () => this.runEstablish(),
      onHardNav: async (url) => {
        this.busy = true;
        try {
          this.engine.bumpGeneration();
          this.pendingDirty = createDirtyState();
          this.hasPending = false;
          this.xoIdMaps.clear();
          this.xoFrameByIframeId.clear();
          this.rewriterBox.current = new UrlRewriter({ originHost: safeHost(url) });
          await this.runEstablish();
        } finally {
          this.busy = false;
        }
      },
    });
  }

  private async waitVirtualDocumentReady(timeoutMs = 90_000): Promise<void> {
    await waitDocumentReadyFn({
      page: this.page,
      isStopped: () => this.stopped,
      getDocumentEpoch: () => this.documentEpoch,
      timeoutMs,
    });
  }

  /** §5.6 / W2 — `cssomInstall` rides first so the client's `<style>` set exists before the first establish chunk parses (D-FLASH). */
  private async runEstablish(): Promise<void> {
    // goto + framenavigated both call establish — share one in-flight walk.
    if (this.establishInFlight) {
      await this.establishInFlight;
      return;
    }
    this.establishInFlight = this.runEstablishUnlocked().finally(() => {
      this.establishInFlight = null;
    });
    await this.establishInFlight;
  }

  private async runEstablishUnlocked(): Promise<void> {
    if (this.stopped || this.established) return;
    const soft = this.pendingNav === 'soft';
    this.pendingNav = null;
    this.mintPageEpoch({ soft, documentEpoch: this.documentEpoch });
    // PP-EST-3 — accumulate live frames before the walk; start the clock so ticks
    // during settle/wait are buffered instead of lost.
    this.engine.beginEstablishHandoff();
    this.startScheduler();
    const ok = await orchestrateLiveEstablish({
      page: this.page,
      cdp: this.cdp,
      rewriter: this.rewriterBox.current,
      treeQuery: this.treeQuery,
      mirror: this.mirrorBox.mirror!,
      establishChunkBytes: this.establishChunkBytes,
      mirrorMaxBytes: this.mirrorMaxBytes,
      pageEpochId: this.pageEpochId,
      pageEpochCommitAtMs: this.pageEpochCommitAtMs,
      generation: this.engine.currentGeneration,
      sequence: this.engine.currentSequence,
      tVirtualMs: () => this.tVirtualMs(),
      onParity: this.events.onParity,
      isStopped: () => this.stopped,
      waitDocumentReady: () => this.waitVirtualDocumentReady(),
      adoptClosedShadows: () => this.adoptClosedShadowsFromCdp(),
      snapshotDocumentRaw: () => snapshotDocumentRaw({
        page: this.page,
        cdp: this.cdp,
        xoIdMaps: this.xoIdMaps,
        xoFrameByIframeId: this.xoFrameByIframeId,
      }),
      markEstablishSnapshot: () => this.engine.markEstablishSnapshot(),
      dropBufferedCssomFromHandoff: () => this.engine.dropBufferedCssomFromHandoff(),
      resetCssom: () => this.engine.cssom.reset(),
      flushEstablishHandoff: () => this.engine.flushEstablishHandoff(),
      emitParts: (parts, meta) => this.emitParts(parts, meta),
      scheduleAssetPrefetch: (mirror, viewport) => {
        // After emit returns — microtask so multipart fan-out is not blocked; no magic delay.
        queueMicrotask(() => {
          void this.scheduleAssetPrefetch(mirror, viewport);
        });
      },
    });
    if (ok && !this.established) {
      this.established = true;
      return;
    }
    // Designed recovery: one re-establish after settle — never DomMap dump / HTTP resync theater.
    if (!ok && !this.stopped && !this.established && !this.establishRetryScheduled) {
      this.establishRetryScheduled = true;
      void (async () => {
        try {
          await this.waitVirtualDocumentReady();
          if (this.stopped || this.established) return;
          await this.runEstablish();
        } finally {
          this.establishRetryScheduled = false;
        }
      })();
    }
  }

  private startScheduler(): void {
    if (this.schedulerStarted) return;
    this.schedulerStarted = true;
    this.engine.start();
  }

  private async scheduleAssetPrefetch(
    mirror: NodeMirror,
    viewport: { width: number; height: number },
  ): Promise<void> {
    await scheduleAssetPrefetch({
      mirror,
      viewport,
      assetQueue: this.assetQueue,
      assetPriorityViewportPx: this.assetPriorityViewportPx,
      assets: this.assets,
      fetchPassThrough: (key) => this.fetchPassThrough(key),
      pageEpochId: this.pageEpochId,
      tVirtualMs: () => this.tVirtualMs(),
      onParity: this.events.onParity,
    });
  }

  private emitParts(parts: Uint8Array[], meta: EncodedFrameMeta): void {
    emitPageProjectionParts({
      parts,
      meta,
      frameStats: this.frameStats,
      onPageProjectionDiff: (diff) => this.events.onPageProjectionDiff(diff),
    });
  }

  /** Run once after `page.goto` — no-op once already established (subsequent boots ride `framenavigated`). */
  async establishBoot(): Promise<void> {
    if (this.stopped || this.established) return;
    await this.runEstablish();
  }

  notePendingNavigation(kind: LivePageProjectionNavigationType): void {
    this.pendingNav = kind;
  }

  getGeneration(): number {
    return this.engine?.currentGeneration ?? 1;
  }

  getAsset(key: string): {
    body: Buffer;
    contentType: string;
    sourceUrl?: string;
    mode: string;
    shareability?: DomAssetShareability;
  } | undefined {
    return this.assets.get(key);
  }

  async fetchPassThrough(
    key: string,
    rangeHeader?: string,
  ): Promise<{
    body: Buffer;
    contentType: string;
    statusCode: number;
    contentRange?: string;
    shareability: DomAssetShareability;
    mode: 'cache' | 'pass-through';
  } | null> {
    return fetchPassThroughAsset({
      page: this.page,
      assets: this.assets,
      authByUrl: this.authByUrl,
      key,
      rangeHeader,
    });
  }

  putUpload(id: string, body: Buffer, contentType: string, name: string): void {
    this.uploads.set(id, { body, contentType, name });
  }

  takeUpload(id: string): { body: Buffer; contentType: string; name: string } | undefined {
    const upload = this.uploads.get(id);
    if (upload) this.uploads.delete(id);
    return upload;
  }

  /** §5.3.5.3 — collapses to the hidden rate ladder rung; mutations keep accumulating (never a hard stop). */
  async pauseLiveEmitForBackpressure(): Promise<void> {
    this.engine?.setHidden(true);
  }

  async resumeLiveEmitAfterBackpressure(): Promise<void> {
    this.engine?.setHidden(false);
  }

  /** §5.9.5 client → server control report (visibility / overrun / backlog → rate ladder). */
  reportClientState(state: {
    visibility: 'visible' | 'hidden';
    queuedFrames: number;
    overrunCount: number;
  }): void {
    if (this.stopped || !this.engine) return;
    applyClientStateReport({
      visibility: state.visibility,
      queuedFrames: state.queuedFrames,
      overrunCount: state.overrunCount,
      setHidden: (hidden) => this.engine.setHidden(hidden),
      degradeRate: () => this.engine.degradeRate(),
      tryRecoverRate: () => this.engine.tryRecoverRate(),
      frameStats: this.frameStats,
      pageEpochId: this.pageEpochId,
      generation: this.engine.currentGeneration,
      onParity: this.events.onParity,
    });
  }

  /** §5.7.2 W3 binary OOB resync from Node mirror (same establish op stream; resync flag). */
  async captureResyncSnapshot(): Promise<{
    generation: number;
    coversThroughSequence: number;
    parts: Uint8Array[];
    pageEpochId?: string;
    source: 'mirror';
    domMapMs?: number;
    cssomCloneMs?: number;
    rewriteMs?: number;
    serializeMs?: number;
  } | null> {
    if (this.stopped || !this.established) return null;
    const mirror = this.mirrorBox.mirror;
    if (!mirror || mirror.root === null) return null;
    return captureMirrorResyncSnapshot({
      page: this.page,
      cdp: this.cdp,
      rewriter: this.rewriterBox.current,
      mirror,
      establishChunkBytes: this.establishChunkBytes,
      pageEpochId: this.pageEpochId,
      generation: this.engine.currentGeneration,
      coversThroughSequence: this.engine.currentSequence,
      onParity: this.events.onParity,
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.detachVirtualTelemetry();
    if (this.stallWatchdog) {
      clearInterval(this.stallWatchdog);
      this.stallWatchdog = null;
    }
    if (this.aggregateTimer) {
      clearInterval(this.aggregateTimer);
      this.aggregateTimer = null;
    }
    this.xoIdMaps.clear();
    this.xoFrameByIframeId.clear();
    try {
      this.engine?.stop();
    } catch {
      /* ignore */
    }
    if (this.cdp) {
      try {
        await this.cdp.detach();
      } catch {
        /* ignore */
      }
      this.cdp = null;
    }
    this.assets.clear();
    this.uploads.clear();
  }
}
