"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LivePageProjection = void 0;
const DomAssetCache_1 = require("../dom/DomAssetCache");
const PageProjection_1 = require("./PageProjection");
const observe_1 = require("./observe");
const fmap_1 = require("./fmap");
const establish_1 = require("./establish");
const establishLive_1 = require("./establishLive");
const cssomLive_1 = require("./cssomLive");
const rewrite_1 = require("./node/rewrite");
const assetPriority_1 = require("./assetPriority");
const documentReady_1 = require("./documentReady");
const snapshotTreeQuery_1 = require("./snapshotTreeQuery");
const cdpLive_1 = require("./cdpLive");
const assetsLive_1 = require("./assetsLive");
const emitLive_1 = require("./emitLive");
/**
 * Live V2 producer on a real `Page`. Owns `PageProjectionEngine`, snapshot cache,
 * asset cache, PageEpoch telemetry, and CDP pierce. §5.5 binary parts go to
 * `onPageProjectionDiff` with empty plane/operation — no JSON→binary adapter.
 * Sensors: Cssom, open+closed shadow, same-origin/XO iframe pierce, scroll/media/
 * DocumentState, soft-nav (PP-NAV-2).
 */
class LivePageProjection {
    page;
    events;
    stopped = false;
    established = false;
    establishInFlight = null;
    establishRetryScheduled = false;
    schedulerStarted = false;
    busy = false;
    pendingDirty = (0, observe_1.createDirtyState)();
    hasPending = false;
    pendingNav = null;
    engine;
    treeQuery;
    mirrorBox = { mirror: null };
    rewriterBox;
    assets = new DomAssetCache_1.DomAssetCache();
    uploads = new Map();
    stallWatchdog = null;
    aggregateTimer = null;
    establishChunkBytes = establish_1.ESTABLISH_CHUNK_BYTES_DEFAULT;
    mirrorMaxBytes = 32 * 1024 * 1024;
    assetPriorityViewportPx = 200;
    aggregateIntervalMs = 10_000;
    frameStallMs = 1000;
    pageEpochId = '';
    pageEpochCommitAtMs = 0;
    tVirtualStartMs = 0;
    virtualDetachers = [];
    frameStats = {
        framesEmitted: 0,
        bytesEmitted: 0,
        lastRateHz: 0,
        stallCount: 0,
        applyOverrunReports: 0,
    };
    /** CDP session shared for soft-nav (PP-NAV-2) and closed-shadow / XO pierce (PP-F-4). */
    cdp = null;
    mainFrameCdpId = null;
    softNavEpoch = null;
    documentEpoch = null;
    /** Absolute URL → whether the site's own request carried Authorization (Network). */
    authByUrl = new Map();
    xoIdMaps = new Map();
    xoFrameByIframeId = new Map();
    assetQueue = new assetPriority_1.AssetPriorityQueue(200);
    constructor(page, events) {
        this.page = page;
        this.events = events;
        this.rewriterBox = { current: new rewrite_1.UrlRewriter({ originHost: (0, cdpLive_1.safeHost)(page.url()) }) };
        this.treeQuery = new snapshotTreeQuery_1.SnapshotTreeQuery(this.mirrorBox, this.rewriterBox);
    }
    static async start(page, events, opts) {
        const proj = new LivePageProjection(page, events);
        proj.tVirtualStartMs = opts?.browserLaunchedAtMs ?? Date.now();
        if (opts?.establishChunkBytes)
            proj.establishChunkBytes = opts.establishChunkBytes;
        if (opts?.mirrorMaxBytes)
            proj.mirrorMaxBytes = opts.mirrorMaxBytes;
        if (opts?.assetPriorityViewportPx)
            proj.assetPriorityViewportPx = opts.assetPriorityViewportPx;
        if (opts?.aggregateIntervalMs)
            proj.aggregateIntervalMs = opts.aggregateIntervalMs;
        if (opts?.frameStallMs && opts.frameStallMs > 0)
            proj.frameStallMs = opts.frameStallMs;
        proj.assetQueue = new assetPriority_1.AssetPriorityQueue(proj.assetPriorityViewportPx);
        if (opts?.assetCacheL1MaxBytes && opts.assetCacheL1MaxBytes > 0) {
            proj.assets = new DomAssetCache_1.DomAssetCache(opts.assetCacheL1MaxBytes);
        }
        await page.exposeBinding('__speculumPPv2Tick', async (_source, tick) => {
            if (proj.stopped)
                return;
            await proj.absorbRawTick(tick);
        });
        proj.engine = new PageProjection_1.PageProjectionEngine({
            events: (0, emitLive_1.buildLiveEngineEvents)({
                emitParts: (parts, meta) => proj.emitParts(parts, meta),
                onGenerationBumped: events.onGenerationBumped,
                frameStats: proj.frameStats,
                onParity: events.onParity,
                getPageEpochId: () => proj.pageEpochId,
                getGeneration: () => proj.engine.currentGeneration,
            }),
            scheduler: (0, emitLive_1.buildLiveScheduler)({
                onSchedulerTick: (tick) => proj.onSchedulerTick(tick),
            }),
            channel: { push: () => { } },
            treeQuery: proj.treeQuery,
            originHost: (0, cdpLive_1.safeHost)(page.url()),
            frameRateHz: opts?.frameRateHz,
            maxFrameBytes: opts?.maxFrameBytes,
            hiddenRateHz: opts?.hiddenRateHz,
            rateRecoverMs: opts?.rateRecoverMs,
            frameStallMs: proj.frameStallMs,
            rateLadder: opts?.rateLadder,
        });
        proj.mirrorBox.mirror = proj.engine.mirror;
        await (0, cdpLive_1.installLivePageScript)(page);
        await (0, cdpLive_1.bridgeLiveOnFrame)(page);
        await proj.ensureCdpSession();
        page.on('request', (req) => {
            try {
                const headers = req.headers();
                const hasAuth = Boolean(headers['authorization'] || headers['Authorization']);
                if (hasAuth)
                    proj.authByUrl.set(req.url(), true);
            }
            catch {
                /* ignore */
            }
        });
        page.on('framenavigated', (frame) => {
            if (proj.stopped)
                return;
            if (frame === page.mainFrame())
                void proj.onMainFrameNavigated();
            else
                void proj.onChildFrameNavigated(frame);
        });
        proj.stallWatchdog = setInterval(() => {
            if (!proj.stopped)
                proj.engine.checkClockStall();
        }, Math.max(50, Math.min(proj.frameStallMs, 500)));
        proj.aggregateTimer = setInterval(() => {
            if (!proj.stopped)
                proj.emitFrameAggregate();
        }, Math.max(1000, proj.aggregateIntervalMs));
        return proj;
    }
    async onSchedulerTick(tick) {
        await (0, emitLive_1.runLiveSchedulerTick)({
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
    async pollAndIngest() {
        const dirty = this.pendingDirty;
        this.pendingDirty = (0, observe_1.createDirtyState)();
        this.hasPending = false;
        const raw = await (0, cdpLive_1.snapshotDocumentRaw)({
            page: this.page,
            cdp: this.cdp,
            xoIdMaps: this.xoIdMaps,
            xoFrameByIframeId: this.xoFrameByIframeId,
        });
        if (!raw)
            return;
        this.treeQuery.load(raw);
        this.engine.ingestDirty(dirty);
    }
    async onChildFrameNavigated(frame) {
        if (this.stopped || frame === this.page.mainFrame())
            return;
        for (const [iframeId, tracked] of this.xoFrameByIframeId) {
            if (tracked === frame) {
                this.hasPending = true;
                void iframeId;
                return;
            }
        }
    }
    async absorbRawTick(tick) {
        if (this.stopped || !tick || typeof tick !== 'object')
            return;
        const t = tick;
        if ((0, emitLive_1.absorbDirtyFromTick)(this.pendingDirty, t.dirty))
            this.hasPending = true;
        // Cssom and DocumentState never depend on the raw-tree poll — feed the engine straight away.
        for (const delta of t.cssom ?? []) {
            await (0, cssomLive_1.absorbCssomDelta)(this.engine.cssom, this.cdp, delta, this.rewriterBox.current);
        }
        if (t.documentState)
            this.engine.noteDocumentState({ op: 'documentState', ...(0, fmap_1.extractDocumentState)(t.documentState) });
    }
    async ensureCdpSession() {
        await (0, cdpLive_1.attachLiveCdpSession)({
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
    async adoptClosedShadowsFromCdp() {
        await (0, cdpLive_1.adoptClosedShadowsWithParity)({
            cdp: this.cdp,
            isStopped: () => this.stopped,
            pageEpochId: this.pageEpochId,
            generation: this.engine?.currentGeneration ?? 1,
            onParity: this.events.onParity,
        });
    }
    mintPageEpoch(args) {
        const minted = (0, emitLive_1.mintLivePageEpoch)({
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
    tVirtualMs() {
        return Date.now() - this.tVirtualStartMs;
    }
    detachVirtualTelemetry() {
        (0, emitLive_1.detachVirtualTelemetry)(this.virtualDetachers);
    }
    attachVirtualTelemetry() {
        (0, emitLive_1.attachVirtualTelemetry)({
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
    emitFrameAggregate() {
        (0, emitLive_1.emitFrameAggregateParity)({
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
    async onMainFrameNavigated() {
        await (0, cdpLive_1.handleLiveMainFrameNavigated)({
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
                    this.pendingDirty = (0, observe_1.createDirtyState)();
                    this.hasPending = false;
                    this.xoIdMaps.clear();
                    this.xoFrameByIframeId.clear();
                    this.rewriterBox.current = new rewrite_1.UrlRewriter({ originHost: (0, cdpLive_1.safeHost)(url) });
                    await this.runEstablish();
                }
                finally {
                    this.busy = false;
                }
            },
        });
    }
    async waitVirtualDocumentReady(timeoutMs = 90_000) {
        await (0, documentReady_1.waitVirtualDocumentReady)({
            page: this.page,
            isStopped: () => this.stopped,
            getDocumentEpoch: () => this.documentEpoch,
            timeoutMs,
        });
    }
    /** §5.6 / W2 — `cssomInstall` rides first so the client's `<style>` set exists before the first establish chunk parses (D-FLASH). */
    async runEstablish() {
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
    async runEstablishUnlocked() {
        if (this.stopped || this.established)
            return;
        const soft = this.pendingNav === 'soft';
        this.pendingNav = null;
        this.mintPageEpoch({ soft, documentEpoch: this.documentEpoch });
        // PP-EST-3 — accumulate live frames before the walk; start the clock so ticks
        // during settle/wait are buffered instead of lost.
        this.engine.beginEstablishHandoff();
        this.startScheduler();
        const ok = await (0, establishLive_1.orchestrateLiveEstablish)({
            page: this.page,
            cdp: this.cdp,
            rewriter: this.rewriterBox.current,
            treeQuery: this.treeQuery,
            mirror: this.mirrorBox.mirror,
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
            snapshotDocumentRaw: () => (0, cdpLive_1.snapshotDocumentRaw)({
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
                    if (this.stopped || this.established)
                        return;
                    await this.runEstablish();
                }
                finally {
                    this.establishRetryScheduled = false;
                }
            })();
        }
    }
    startScheduler() {
        if (this.schedulerStarted)
            return;
        this.schedulerStarted = true;
        this.engine.start();
    }
    async scheduleAssetPrefetch(mirror, viewport) {
        await (0, assetsLive_1.scheduleAssetPrefetch)({
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
    emitParts(parts, meta) {
        (0, emitLive_1.emitPageProjectionParts)({
            parts,
            meta,
            frameStats: this.frameStats,
            onPageProjectionDiff: (diff) => this.events.onPageProjectionDiff(diff),
        });
    }
    /** Run once after `page.goto` — no-op once already established (subsequent boots ride `framenavigated`). */
    async establishBoot() {
        if (this.stopped || this.established)
            return;
        await this.runEstablish();
    }
    notePendingNavigation(kind) {
        this.pendingNav = kind;
    }
    getGeneration() {
        return this.engine?.currentGeneration ?? 1;
    }
    getAsset(key) {
        return this.assets.get(key);
    }
    async fetchPassThrough(key, rangeHeader) {
        return (0, assetsLive_1.fetchPassThroughAsset)({
            page: this.page,
            assets: this.assets,
            authByUrl: this.authByUrl,
            key,
            rangeHeader,
        });
    }
    putUpload(id, body, contentType, name) {
        this.uploads.set(id, { body, contentType, name });
    }
    takeUpload(id) {
        const upload = this.uploads.get(id);
        if (upload)
            this.uploads.delete(id);
        return upload;
    }
    /** §5.3.5.3 — collapses to the hidden rate ladder rung; mutations keep accumulating (never a hard stop). */
    async pauseLiveEmitForBackpressure() {
        this.engine?.setHidden(true);
    }
    async resumeLiveEmitAfterBackpressure() {
        this.engine?.setHidden(false);
    }
    /** §5.9.5 client → server control report (visibility / overrun / backlog → rate ladder). */
    reportClientState(state) {
        if (this.stopped || !this.engine)
            return;
        (0, emitLive_1.applyClientStateReport)({
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
    async captureResyncSnapshot() {
        if (this.stopped || !this.established)
            return null;
        const mirror = this.mirrorBox.mirror;
        if (!mirror || mirror.root === null)
            return null;
        return (0, establishLive_1.captureMirrorResyncSnapshot)({
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
    async stop() {
        if (this.stopped)
            return;
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
        }
        catch {
            /* ignore */
        }
        if (this.cdp) {
            try {
                await this.cdp.detach();
            }
            catch {
                /* ignore */
            }
            this.cdp = null;
        }
        this.assets.clear();
        this.uploads.clear();
    }
}
exports.LivePageProjection = LivePageProjection;
//# sourceMappingURL=liveAttach.js.map