"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LivePageProjection = void 0;
const DomAssetCache_1 = require("../dom/DomAssetCache");
const inpageScript_1 = require("./inpageScript");
const PageProjection_1 = require("./PageProjection");
const observe_1 = require("./observe");
const fmap_1 = require("./fmap");
const identity_1 = require("./identity");
const encode_1 = require("./encode");
const establish_1 = require("./establish");
const rewrite_1 = require("./node/rewrite");
const cdpPierce_1 = require("./cdpPierce");
const assetPriority_1 = require("./assetPriority");
const node_crypto_1 = require("node:crypto");
/**
 * §9 live cutover — Node-side orchestration for the V2 producer on a real `Page`.
 * Sensors: Cssom, open+closed shadow (CDP Runtime.callFunctionOn adopt), same-origin
 * and cross-origin iframe pierce, scroll/media/DocumentState, soft-nav (PP-NAV-2).
 */
const WIRE_VERSION = 1;
/**
 * §5.3.5.1 sensible default — a client backlog beyond a couple of frames' worth
 * signals the client can't keep up even before an apply overrun lands; treated
 * the same as a reported overrun. `WP14` density calibration is expected to revise.
 */
const CLIENT_STATE_QUEUED_FRAMES_DEGRADE_THRESHOLD = 4;
function safeHost(url) {
    try {
        return new URL(url).host || 'invalid.local';
    }
    catch {
        return 'invalid.local';
    }
}
function isBlankDocumentUrl(url) {
    const u = (url || '').trim().toLowerCase();
    return !u || u === 'about:blank' || u.startsWith('chrome-error://');
}
function collectTagsPreorder(node, out = []) {
    out.push(node.kind === 'element' ? node.tag : node.kind === 'text' ? '#text' : '#comment');
    if (node.kind === 'element')
        for (const child of node.children)
            collectTagsPreorder(child, out);
    return out;
}
/** Node-side snapshot cache — a full raw-tree walk per tick, read synchronously by `FrameTreeQuery`. */
class SnapshotTreeQuery {
    mirrorBox;
    rewriterBox;
    byId = new Map();
    constructor(mirrorBox, rewriterBox) {
        this.mirrorBox = mirrorBox;
        this.rewriterBox = rewriterBox;
    }
    load(root) {
        const next = new Map();
        if (root) {
            let order = 0;
            const walk = (node, parentId) => {
                next.set(node.id, { raw: node, parentId, order: order++ });
                if (node.kind === 'element') {
                    for (const child of node.children)
                        walk(child, node.id);
                }
            };
            walk(root, identity_1.NONE_NODE_ID);
        }
        this.byId = next;
    }
    isConnected() {
        return true; // anything reachable from this tick's walk is, by construction, connected.
    }
    resolve(id) {
        return this.byId.has(id) ? { id } : undefined;
    }
    isWithin(id, ancestors) {
        let cur = id;
        while (cur !== undefined && cur !== identity_1.NONE_NODE_ID) {
            if (ancestors.has(cur))
                return true;
            cur = this.byId.get(cur)?.parentId;
        }
        return false;
    }
    childListSnapshot(parentId) {
        const entry = this.byId.get(parentId);
        if (!entry || entry.raw.kind !== 'element')
            return undefined;
        const mirror = this.mirrorBox.mirror;
        return entry.raw.children
            .filter((child) => this.byId.has(child.id))
            .map((child) => mirror?.get(child.id) !== undefined
            ? { kind: 'existing', id: child.id }
            : { kind: 'fresh', node: this.buildFullFNode(child) });
    }
    fullSnapshot(id) {
        const entry = this.byId.get(id);
        if (!entry)
            return undefined;
        return this.buildShallowFNode(entry.raw);
    }
    compareDocumentOrder(a, b) {
        return (this.byId.get(a)?.order ?? 0) - (this.byId.get(b)?.order ?? 0);
    }
    /** Full recursive F snapshot — used for `childList` fresh entries and the establish walk. */
    buildFullFNode(raw) {
        if (raw.kind !== 'element')
            return this.leafFNode(raw);
        return (0, fmap_1.publishElementSnapshot)({
            id: raw.id,
            rawTag: raw.tag,
            rawAttrs: this.rewriteAttrs(raw),
            children: raw.children.filter((c) => this.byId.has(c.id)).map((c) => this.buildFullFNode(c)),
            iframeHost: raw.tag.toLowerCase() === 'iframe',
            shadowRoot: raw.shadowRoot,
            shadowClosed: raw.shadowClosed,
            state: raw.state,
        });
    }
    buildShallowFNode(raw) {
        if (raw.kind !== 'element')
            return this.leafFNode(raw);
        return (0, fmap_1.publishElementSnapshot)({
            id: raw.id,
            rawTag: raw.tag,
            rawAttrs: this.rewriteAttrs(raw),
            children: [], // §5.4.1 — patch snapshots never carry children.
            iframeHost: raw.tag.toLowerCase() === 'iframe',
            shadowRoot: raw.shadowRoot,
            shadowClosed: raw.shadowClosed,
            state: raw.state,
        });
    }
    leafFNode(raw) {
        return raw.kind === 'text' ? (0, fmap_1.publishTextSnapshot)(raw.id, raw.value) : (0, fmap_1.publishCommentSnapshot)(raw.id, raw.value);
    }
    rewriteAttrs(raw) {
        const rewriter = this.rewriterBox.current;
        return raw.attrs.map(([name, value]) => [name, rewriter.rewriteAttrValue(name, value)]);
    }
}
const BRIDGE_ONFRAME_SNIPPET = `(() => {
  const api = window.__speculumPageProjectionV2;
  if (!api || api.__ppv2Bridged) return;
  api.__ppv2Bridged = true;
  api.onFrame((tick) => {
    try { window.__speculumPPv2Tick(tick); } catch (e) {}
  });
})()`;
const SNAPSHOT_DOCUMENT_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.snapshotDocument === 'function')
    ? window.__speculumPageProjectionV2.snapshotDocument()
    : null
`;
const SNAPSHOT_CSSOM_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.snapshotCssom === 'function')
    ? window.__speculumPageProjectionV2.snapshotCssom()
    : []
`;
const SNAPSHOT_DOCUMENT_STATE_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.snapshotDocumentState === 'function')
    ? window.__speculumPageProjectionV2.snapshotDocumentState()
    : null
`;
const READ_EPOCH_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.getEpochId === 'function')
    ? window.__speculumPageProjectionV2.getEpochId()
    : null
`;
/**
 * Live V2 producer on a real `Page`. Owns `PageProjectionEngine`, snapshot cache,
 * asset cache, PageEpoch telemetry, and CDP pierce. §5.5 binary parts go to
 * `onPageProjectionDiff` with empty plane/operation — no JSON→binary adapter.
 */
class LivePageProjection {
    page;
    events;
    stopped = false;
    established = false;
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
    mirrorMaxBytes = 4 * 1024 * 1024;
    assetPriorityViewportPx = 200;
    aggregateIntervalMs = 10_000;
    frameStallMs = 1000;
    lastAggregateAtMs = 0;
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
    /** Child-frame id → remapped parent-space id (XO pierce). */
    xoIdMaps = new Map();
    xoFrameByIframeId = new Map();
    assetQueue = new assetPriority_1.AssetPriorityQueue(200);
    constructor(page, events) {
        this.page = page;
        this.events = events;
        this.rewriterBox = { current: new rewrite_1.UrlRewriter({ originHost: safeHost(page.url()) }) };
        this.treeQuery = new SnapshotTreeQuery(this.mirrorBox, this.rewriterBox);
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
        await page.exposeBinding('__speculumPPv2Tick', (_source, tick) => {
            if (proj.stopped)
                return;
            proj.absorbRawTick(tick);
        });
        proj.engine = new PageProjection_1.PageProjectionEngine({
            events: proj.buildEngineEvents(),
            scheduler: proj.buildScheduler(),
            channel: { push: () => { } },
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
        await proj.installPageScript();
        await proj.bridgeOnFrame();
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
    buildEngineEvents() {
        return {
            onFrame: (parts, meta) => this.emitParts(parts, meta),
            onGenerationBumped: (event) => this.events.onGenerationBumped?.({ ...event, reason: 'main_frame_navigated' }),
            onClockStalled: (info) => {
                this.frameStats.stallCount += 1;
                this.events.onParity?.('parity_frame_clock_stalled', {
                    pageEpochId: this.pageEpochId,
                    sinceLastTickMs: info.sinceLastTickMs,
                    generation: this.engine.currentGeneration,
                });
            },
            onRateChanged: (hz) => {
                const fromHz = this.frameStats.lastRateHz;
                this.frameStats.lastRateHz = hz;
                this.events.onParity?.('parity_frame_rate_changed', {
                    pageEpochId: this.pageEpochId,
                    fromHz,
                    toHz: hz,
                    generation: this.engine.currentGeneration,
                });
            },
        };
    }
    buildScheduler() {
        return {
            setInterval: (callback, ms) => setInterval(() => void this.onSchedulerTick(callback), Math.max(1, ms)),
            clearInterval: (handle) => clearInterval(handle),
            now: () => Date.now(),
        };
    }
    /** One clock tick: poll the page for a fresh snapshot only when something is dirty, then flush. */
    async onSchedulerTick(tick) {
        if (this.stopped || this.busy)
            return;
        if (this.hasPending && this.established) {
            this.busy = true;
            try {
                await this.pollAndIngest();
            }
            catch {
                /* mid-navigation — next tick retries against the fresh document. */
            }
            finally {
                this.busy = false;
            }
        }
        if (!this.stopped)
            tick();
    }
    async pollAndIngest() {
        const dirty = this.pendingDirty;
        this.pendingDirty = (0, observe_1.createDirtyState)();
        this.hasPending = false;
        const raw = await this.snapshotDocumentRaw();
        if (!raw)
            return;
        this.treeQuery.load(raw);
        this.engine.ingestDirty(dirty);
    }
    async snapshotDocumentRaw() {
        try {
            const result = await this.page.evaluate(SNAPSHOT_DOCUMENT_SNIPPET);
            let raw = result ?? null;
            if (raw)
                raw = await this.mergeCrossOriginIframes(raw);
            return raw;
        }
        catch {
            return null;
        }
    }
    /** PP-F-4 — inject V2 script into XO child frames and merge remapped interiors under the host iframe. */
    async mergeCrossOriginIframes(raw) {
        const xoIds = (0, cdpPierce_1.collectXoIframeIds)(raw);
        if (xoIds.length === 0)
            return raw;
        const nextId = { value: (0, cdpPierce_1.maxRawNodeId)(raw) + 1 };
        for (const iframeId of xoIds) {
            try {
                const handle = await this.page.evaluateHandle((id) => {
                    const g = globalThis;
                    return g.__speculumPageProjectionV2?.resolve?.(id) ?? null;
                }, iframeId);
                const el = handle.asElement();
                if (!el) {
                    await handle.dispose().catch(() => undefined);
                    continue;
                }
                const frame = await el.contentFrame();
                await handle.dispose().catch(() => undefined);
                if (!frame || frame === this.page.mainFrame())
                    continue;
                await frame.evaluate('try { delete window.__speculumPageProjectionV2; } catch (e) {}').catch(() => undefined);
                await frame.evaluate(inpageScript_1.PAGE_PROJECTION_V2_PAGE_SCRIPT);
                await frame.evaluate(`(() => {
          const api = window.__speculumPageProjectionV2;
          if (!api || typeof api.onFrame !== 'function') return;
          api.onFrame((tick) => {
            try {
              window.__speculumPPv2Tick && window.__speculumPPv2Tick(tick);
            } catch (e) {}
          });
        })()`).catch(() => undefined);
                const childRaw = (await frame.evaluate(SNAPSHOT_DOCUMENT_SNIPPET));
                if (!childRaw)
                    continue;
                const idMap = new Map();
                const remapped = (0, cdpPierce_1.remapPierceTree)(childRaw, nextId, idMap);
                this.xoIdMaps.set(frame, idMap);
                this.xoFrameByIframeId.set(iframeId, frame);
                (0, cdpPierce_1.attachChildUnderIframe)(raw, iframeId, remapped);
                if (this.cdp)
                    await (0, cdpPierce_1.adoptAllClosedShadowsFromCdp)(this.cdp).catch(() => 0);
            }
            catch {
                /* frame detached / mid-navigation */
            }
        }
        return raw;
    }
    async onChildFrameNavigated(frame) {
        if (this.stopped || frame === this.page.mainFrame())
            return;
        // Soft-refresh XO pierce on child navigations when we already track the host.
        for (const [iframeId, tracked] of this.xoFrameByIframeId) {
            if (tracked === frame) {
                this.hasPending = true;
                void iframeId;
                return;
            }
        }
    }
    async snapshotCssomSheets() {
        try {
            const result = await this.page.evaluate(SNAPSHOT_CSSOM_SNIPPET);
            return Array.isArray(result) ? result : [];
        }
        catch {
            return [];
        }
    }
    async snapshotDocumentStateRaw() {
        try {
            const result = await this.page.evaluate(SNAPSHOT_DOCUMENT_STATE_SNIPPET);
            if (!result || typeof result !== 'object')
                return null;
            const state = (0, fmap_1.extractDocumentState)(result);
            return { op: 'documentState', ...state };
        }
        catch {
            return null;
        }
    }
    /** Applies one `tick.cssom[]` delta directly onto the engine's coalescer (§5.10.4) — no raw-tree dependency. */
    absorbCssomDelta(delta) {
        switch (delta.op) {
            case 'addSheet':
                this.engine.cssom.addSheet(delta.sheetId, delta.index, delta.sheet);
                return;
            case 'removeSheet':
                this.engine.cssom.removeSheet(delta.sheetId);
                return;
            case 'addRule':
                this.engine.cssom.addRule(delta.sheetId, delta.ruleId, delta.index, delta.rule);
                return;
            case 'removeRule':
                this.engine.cssom.removeRule(delta.sheetId, delta.ruleId);
                return;
            case 'patchRule':
                this.engine.cssom.patchRule(delta.ruleId, delta.cssText);
                return;
        }
    }
    absorbRawTick(tick) {
        if (this.stopped || !tick || typeof tick !== 'object')
            return;
        const t = tick;
        const dirty = t.dirty;
        let any = false;
        if (dirty) {
            for (const id of dirty.newIds ?? []) {
                this.pendingDirty.newIds.add(id);
                any = true;
            }
            for (const id of dirty.dirtyParents ?? []) {
                this.pendingDirty.dirtyParents.add(id);
                any = true;
            }
            for (const id of dirty.attrDirty ?? []) {
                this.pendingDirty.attrDirty.add(id);
                any = true;
            }
            for (const id of dirty.textDirty ?? []) {
                this.pendingDirty.textDirty.add(id);
                any = true;
            }
            for (const id of dirty.stateDirty ?? []) {
                this.pendingDirty.stateDirty.add(id);
                any = true;
            }
            for (const id of dirty.detached ?? []) {
                this.pendingDirty.detached.add(id);
                any = true;
            }
            for (const [id, x, y] of dirty.scrollDirty ?? []) {
                this.pendingDirty.scrollDirty.set(id, { x, y });
                any = true;
            }
        }
        if (any)
            this.hasPending = true;
        // Cssom and DocumentState never depend on the raw-tree poll — feed the engine straight away.
        for (const delta of t.cssom ?? [])
            this.absorbCssomDelta(delta);
        if (t.documentState)
            this.engine.noteDocumentState({ op: 'documentState', ...(0, fmap_1.extractDocumentState)(t.documentState) });
    }
    async installPageScript() {
        await this.page.addInitScript({ content: inpageScript_1.PAGE_PROJECTION_V2_PAGE_SCRIPT });
        await this.page.evaluate(inpageScript_1.PAGE_PROJECTION_V2_PAGE_SCRIPT).catch(() => { });
    }
    async bridgeOnFrame() {
        await this.page.evaluate(BRIDGE_ONFRAME_SNIPPET).catch(() => { });
    }
    async readDocumentEpoch() {
        try {
            const epoch = await this.page.evaluate(READ_EPOCH_SNIPPET);
            return typeof epoch === 'string' ? epoch : null;
        }
        catch {
            return null;
        }
    }
    /**
     * W4 — CDP session for soft-nav corroboration (Page.navigatedWithinDocument) and
     * closed-shadow / XO pierce. Soft-nav sets softNavEpoch before framenavigated
     * so onMainFrameNavigated can skip generation bump (PP-NAV-2).
     */
    async ensureCdpSession() {
        if (this.cdp || this.stopped)
            return;
        try {
            this.cdp = await this.page.context().newCDPSession(this.page);
            await this.cdp.send('DOM.enable');
            await this.cdp.send('Page.enable');
            try {
                const frameTree = (await this.cdp.send('Page.getFrameTree'));
                const id = frameTree?.frameTree?.frame?.id;
                if (typeof id === 'string' && id)
                    this.mainFrameCdpId = id;
            }
            catch {
                /* optional */
            }
            this.cdp.on('Page.frameNavigated', (ev) => {
                if (ev.frame && !ev.frame.parentId && typeof ev.frame.id === 'string') {
                    this.mainFrameCdpId = ev.frame.id;
                }
            });
            this.cdp.on('Page.navigatedWithinDocument', (ev) => {
                if (this.stopped)
                    return;
                if (this.mainFrameCdpId && ev.frameId && ev.frameId !== this.mainFrameCdpId)
                    return;
                void this.readDocumentEpoch()
                    .then((epoch) => {
                    if (epoch) {
                        this.softNavEpoch = epoch;
                        this.mintPageEpoch({ soft: true, documentEpoch: epoch });
                    }
                    this.events.onSoftNavObserved?.({
                        generation: this.engine?.currentGeneration ?? 1,
                        url: (() => {
                            try {
                                return this.page.url();
                            }
                            catch {
                                return undefined;
                            }
                        })(),
                        documentEpoch: epoch ?? undefined,
                        liveArmed: this.established,
                    });
                })
                    .catch(() => { });
            });
            this.cdp.on('DOM.shadowRootPushed', (ev) => {
                if (this.stopped || !this.cdp)
                    return;
                const hostId = ev.hostId;
                const shadowId = ev.rootId ?? ev.root?.nodeId;
                if (hostId == null || shadowId == null)
                    return;
                void (0, cdpPierce_1.adoptClosedShadowPair)(this.cdp, hostId, shadowId).then(() => {
                    this.hasPending = true;
                });
            });
            await this.adoptClosedShadowsFromCdp();
        }
        catch {
            /* CDP unavailable — soft-nav falls back to hard-nav; open shadows still work via attachShadow hook. */
        }
    }
    async adoptClosedShadowsFromCdp() {
        if (!this.cdp || this.stopped)
            return;
        try {
            const n = await (0, cdpPierce_1.adoptAllClosedShadowsFromCdp)(this.cdp);
            if (n > 0) {
                this.events.onParity?.('parity_closed_shadow_adopted', {
                    pageEpochId: this.pageEpochId,
                    count: n,
                    generation: this.engine?.currentGeneration ?? 1,
                });
            }
        }
        catch {
            /* ignore */
        }
    }
    /** §5.15.6 — mint a pageEpochId per Document; soft-nav mints a new epoch without generation bump. */
    mintPageEpoch(args) {
        this.detachVirtualTelemetry();
        this.pageEpochId = (0, node_crypto_1.randomUUID)();
        this.pageEpochCommitAtMs = Date.now();
        this.events.onParity?.('parity_virtual_nav_commit', {
            pageEpochId: this.pageEpochId,
            soft: args.soft,
            navigationType: args.soft ? 'soft' : 'hard',
            documentEpoch: args.documentEpoch ?? this.documentEpoch,
            generation: this.engine?.currentGeneration ?? 1,
            url: (() => {
                try {
                    return this.page.url();
                }
                catch {
                    return undefined;
                }
            })(),
            tVirtualMs: Date.now() - this.tVirtualStartMs,
        });
        this.attachVirtualTelemetry();
    }
    tVirtualMs() {
        return Date.now() - this.tVirtualStartMs;
    }
    detachVirtualTelemetry() {
        for (const d of this.virtualDetachers.splice(0)) {
            try {
                d();
            }
            catch {
                /* page closed */
            }
        }
    }
    attachVirtualTelemetry() {
        if (this.stopped || !this.pageEpochId)
            return;
        const epochId = this.pageEpochId;
        const commitAt = this.pageEpochCommitAtMs;
        const emitLifecycle = (name) => {
            this.events.onParity?.('parity_virtual_lifecycle', {
                pageEpochId: epochId,
                name,
                tSinceCommitMs: Date.now() - commitAt,
                tVirtualMs: this.tVirtualMs(),
            });
        };
        const onDomContentLoaded = () => emitLifecycle('domcontentloaded');
        const onLoad = () => emitLifecycle('load');
        this.page.on('domcontentloaded', onDomContentLoaded);
        this.page.on('load', onLoad);
        this.virtualDetachers.push(() => this.page.off('domcontentloaded', onDomContentLoaded));
        this.virtualDetachers.push(() => this.page.off('load', onLoad));
        const onConsole = (msg) => {
            if (msg.type() !== 'error')
                return;
            this.events.onParity?.('parity_virtual_page_error', {
                pageEpochId: epochId,
                source: 'console',
                message: msg.text().slice(0, 500),
                tVirtualMs: this.tVirtualMs(),
            });
        };
        const onPageError = (err) => {
            this.events.onParity?.('parity_virtual_page_error', {
                pageEpochId: epochId,
                source: 'pageerror',
                message: (err.message || String(err)).slice(0, 500),
                tVirtualMs: this.tVirtualMs(),
            });
        };
        this.page.on('console', onConsole);
        this.page.on('pageerror', onPageError);
        this.virtualDetachers.push(() => this.page.off('console', onConsole));
        this.virtualDetachers.push(() => this.page.off('pageerror', onPageError));
        void this.page.evaluate(`(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return null;
      const rel = (end, start) => (typeof end === 'number' && typeof start === 'number' && end >= start ? Math.round(end - start) : null);
      return {
        redirectMs: rel(nav.redirectEnd, nav.redirectStart),
        dnsMs: rel(nav.domainLookupEnd, nav.domainLookupStart),
        connectMs: rel(nav.connectEnd, nav.connectStart),
        ttfbMs: rel(nav.responseStart, nav.requestStart),
        domInteractiveMs: rel(nav.domInteractive, nav.startTime),
        domContentLoadedMs: rel(nav.domContentLoadedEventEnd, nav.startTime),
        loadEventMs: rel(nav.loadEventEnd, nav.startTime),
      };
    })()`).then((timing) => {
            if (!timing || this.stopped || this.pageEpochId !== epochId)
                return;
            this.events.onParity?.('parity_virtual_nav_timing', {
                pageEpochId: epochId,
                ...timing,
                tVirtualMs: this.tVirtualMs(),
            });
        }).catch(() => { });
    }
    emitFrameAggregate() {
        const now = Date.now();
        this.lastAggregateAtMs = now;
        this.events.onParity?.('parity_frame_aggregate', {
            pageEpochId: this.pageEpochId,
            generation: this.engine?.currentGeneration ?? 1,
            framesEmitted: this.frameStats.framesEmitted,
            bytesEmitted: this.frameStats.bytesEmitted,
            rateHz: this.engine?.rateHz ?? this.frameStats.lastRateHz,
            stallCount: this.frameStats.stallCount,
            applyOverrunReports: this.frameStats.applyOverrunReports,
            mirrorBytes: this.mirrorBox.mirror?.estimateBytes?.() ?? this.mirrorBox.mirror?.size ?? 0,
            intervalMs: this.aggregateIntervalMs,
            tVirtualMs: this.tVirtualMs(),
        });
    }
    async onMainFrameNavigated() {
        if (this.stopped)
            return;
        try {
            const url = this.page.url();
            if (isBlankDocumentUrl(url))
                return;
            await this.installPageScript();
            await this.bridgeOnFrame();
            await this.ensureCdpSession();
            await this.adoptClosedShadowsFromCdp();
            const epoch = await this.readDocumentEpoch();
            if (epoch === null)
                return;
            // Soft (same-document) navigation — never bump generation / re-establish (PP-NAV-2).
            if (this.softNavEpoch !== null && epoch === this.softNavEpoch) {
                this.softNavEpoch = null;
                this.documentEpoch = epoch;
                // Soft-nav already minted pageEpoch via CDP navigatedWithinDocument when available.
                if (!this.pageEpochId)
                    this.mintPageEpoch({ soft: true, documentEpoch: epoch });
                this.events.onSoftNavObserved?.({
                    generation: this.engine.currentGeneration,
                    url,
                    documentEpoch: epoch,
                    liveArmed: this.established,
                });
                return;
            }
            if (!this.established) {
                await this.runEstablish();
                this.documentEpoch = epoch;
                return;
            }
            if (epoch === this.documentEpoch)
                return;
            this.documentEpoch = epoch;
            this.busy = true;
            try {
                this.engine.bumpGeneration();
                this.pendingDirty = (0, observe_1.createDirtyState)();
                this.hasPending = false;
                this.xoIdMaps.clear();
                this.xoFrameByIframeId.clear();
                this.rewriterBox.current = new rewrite_1.UrlRewriter({ originHost: safeHost(url) });
                await this.runEstablish();
            }
            finally {
                this.busy = false;
            }
        }
        catch {
            /* mid-navigation — the next framenavigated retries. */
        }
    }
    /** §5.6 / W2 — `cssomInstall` rides first so the client's `<style>` set exists before the first establish chunk parses (D-FLASH). */
    async runEstablish() {
        const soft = this.pendingNav === 'soft';
        this.pendingNav = null;
        this.mintPageEpoch({ soft, documentEpoch: this.documentEpoch });
        this.events.onParity?.('parity_establish_dom_map_started', {
            pageEpochId: this.pageEpochId,
            generation: this.engine.currentGeneration,
            path: 'live_v2',
            tVirtualMs: this.tVirtualMs(),
        });
        const establishStarted = Date.now();
        await this.adoptClosedShadowsFromCdp();
        const raw = await this.snapshotDocumentRaw();
        if (!raw) {
            this.events.onParity?.('parity_establish_failed', {
                pageEpochId: this.pageEpochId,
                generation: this.engine.currentGeneration,
                errorCode: 'dom_map_empty',
                phase: 'dom_map',
                tVirtualMs: this.tVirtualMs(),
            });
            return;
        }
        this.treeQuery.load(raw);
        const rootFNode = this.treeQuery.buildFullFNode(raw);
        const mirror = this.mirrorBox.mirror;
        mirror.clear();
        mirror.seedRoot(rootFNode);
        this.enforceMirrorMaxBytes(mirror);
        const html = mirror.serializeToHtml();
        const { nodeCount, checksum } = (0, establish_1.computeEstablishChecksum)(collectTagsPreorder(rootFNode));
        const chunks = (0, establish_1.splitHtmlIntoChunks)(html, this.establishChunkBytes);
        const viewport = this.page.viewportSize() ?? { width: 0, height: 0 };
        this.engine.cssom.reset(); // §5.10 — the full install below supersedes any deltas accumulated before establish.
        this.events.onParity?.('parity_establish_cssom_install_started', {
            pageEpochId: this.pageEpochId,
            generation: this.engine.currentGeneration,
            source: 'snapshot',
            tVirtualMs: this.tVirtualMs(),
        });
        const sheets = await this.snapshotCssomSheets();
        const documentState = await this.snapshotDocumentStateRaw();
        this.events.onParity?.('parity_establish_cssom_install_completed', {
            pageEpochId: this.pageEpochId,
            generation: this.engine.currentGeneration,
            source: 'snapshot',
            durationMs: 0,
            sheetCount: sheets.length,
            ruleCount: sheets.reduce((n, s) => n + (s.rules?.length ?? 0), 0),
            seededSheetCount: sheets.length,
            tVirtualMs: this.tVirtualMs(),
        });
        const ops = [
            { op: 'cssomInstall', sheets },
            { op: 'establishBegin', payload: (0, establish_1.buildEstablishBegin)(this.engine.currentGeneration, viewport, { x: 0, y: 0 }) },
            ...chunks.map((chunk) => ({ op: 'establishChunk', bytes: Buffer.from(chunk, 'utf8') })),
            { op: 'establishEnd', nodeCount, checksum },
            ...(documentState ? [documentState] : []),
        ];
        const meta = {
            generation: this.engine.currentGeneration,
            sequence: this.engine.currentSequence,
            establish: true,
        };
        this.emitParts((0, encode_1.encodeFrame)(ops, meta), meta);
        this.events.onParity?.('parity_establish_first_diff_emitted', {
            pageEpochId: this.pageEpochId,
            generation: this.engine.currentGeneration,
            plane: 'dom',
            operation: 'establish',
            sequence: this.engine.currentSequence,
            nodeCount,
            tSinceCommitMs: Date.now() - this.pageEpochCommitAtMs,
            tVirtualMs: this.tVirtualMs(),
        });
        this.events.onParity?.('parity_establish_completed', {
            pageEpochId: this.pageEpochId,
            generation: this.engine.currentGeneration,
            totalMs: Date.now() - establishStarted,
            tSinceCommitMs: Date.now() - this.pageEpochCommitAtMs,
            tVirtualMs: this.tVirtualMs(),
        });
        void this.scheduleAssetPrefetch(mirror, viewport);
        if (!this.established) {
            this.established = true;
            this.startScheduler();
        }
    }
    startScheduler() {
        if (this.schedulerStarted)
            return;
        this.schedulerStarted = true;
        this.engine.start();
    }
    /** §5.12.1 — enqueue L1 fetches by viewport proximity, then drain highest-first. */
    async scheduleAssetPrefetch(mirror, viewport) {
        this.assetQueue.clear();
        const margin = this.assetPriorityViewportPx;
        const rootId = mirror.root;
        if (rootId == null)
            return;
        const walk = (id) => {
            const node = mirror.get(id);
            if (!node || node.kind !== 'element')
                return;
            const tag = node.tag.toLowerCase();
            const isCss = tag === 'link' && /stylesheet/i.test(node.attrs['rel'] ?? '');
            const candidates = [];
            for (const attr of ['src', 'href', 'poster', 'data-src']) {
                const v = node.attrs[attr];
                if (v && v.startsWith(fmap_1.VIRTUAL_ASSETS_PREFIX))
                    candidates.push(v);
            }
            for (const key of candidates) {
                // Without layout geometry on the Node mirror, treat document order as
                // increasing distance so above-the-fold ids drain first; CSS always wins.
                const distancePx = isCss ? 0 : Math.max(0, id * 4 - viewport.height);
                const sourceUrl = key.slice(fmap_1.VIRTUAL_ASSETS_PREFIX.length);
                this.assetQueue.enqueue({
                    key,
                    sourceUrl: sourceUrl.includes('://') ? sourceUrl : `https://${sourceUrl}`,
                    distancePx,
                    isCss,
                });
            }
            for (const childId of node.childIds)
                walk(childId);
        };
        walk(rootId);
        void margin;
        let drained = 0;
        while (drained < 32) {
            const job = this.assetQueue.takeNext();
            if (!job)
                break;
            drained += 1;
            const started = Date.now();
            const hit = this.assets.get(job.key);
            if (hit)
                continue;
            const fetched = await this.fetchPassThrough(job.key);
            const durationMs = Date.now() - started;
            if (!fetched) {
                this.events.onParity?.('parity_asset_fetch_finished', {
                    pageEpochId: this.pageEpochId,
                    urlKey: job.key,
                    durationMs,
                    bytes: 0,
                    mode: 'miss',
                    ok: false,
                    tVirtualMs: this.tVirtualMs(),
                });
            }
            else {
                this.events.onParity?.('parity_asset_fetch_finished', {
                    pageEpochId: this.pageEpochId,
                    urlKey: job.key,
                    durationMs,
                    bytes: fetched.body.byteLength,
                    mode: fetched.mode,
                    ok: true,
                    tVirtualMs: this.tVirtualMs(),
                });
            }
        }
    }
    /** E7 — mirror byte budget; trim leaves with telemetry (never silent). */
    enforceMirrorMaxBytes(mirror) {
        const before = mirror.estimateBytes();
        if (before <= this.mirrorMaxBytes)
            return;
        const removed = mirror.trimToBudget(this.mirrorMaxBytes);
        this.events.onParity?.('parity_mirror_trim', {
            pageEpochId: this.pageEpochId,
            beforeBytes: before,
            afterBytes: mirror.estimateBytes(),
            removedNodes: removed,
            mirrorMaxBytes: this.mirrorMaxBytes,
            generation: this.engine.currentGeneration,
        });
    }
    emitParts(parts, meta) {
        const partCount = parts.length;
        const flags = (meta.establish ? 0b01 : 0) | (meta.resync ? 0b10 : 0);
        const timestampMs = Date.now();
        this.frameStats.framesEmitted += 1;
        for (const body of parts)
            this.frameStats.bytesEmitted += body.byteLength;
        parts.forEach((body, partIndex) => {
            this.events.onPageProjectionDiff({
                sequence: meta.sequence,
                generation: meta.generation,
                plane: '',
                operation: '',
                timestampMs,
                body,
                partIndex,
                partCount,
                flags,
                version: WIRE_VERSION,
            });
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
    /** First header value, tolerating Playwright's `string | string[]` header shape. */
    static headerValue(headers, name) {
        const raw = headers[name];
        return typeof raw === 'string' ? raw : raw?.[0];
    }
    /**
     * §5.12.2.1 — whether *this* request would have carried a `Cookie` header. Read from
     * the browser context's own cookie jar for `sourceUrl` rather than guessed, so the
     * signal the API's `SharedAssetCacheL2` predicate gates on is never fabricated.
     */
    async requestHadCookie(sourceUrl) {
        try {
            const cookies = await this.page.context().cookies([sourceUrl]);
            return cookies.length > 0;
        }
        catch {
            return false;
        }
    }
    async fetchPassThrough(key, rangeHeader) {
        const cached = this.assets.get(key);
        const sourceUrl = cached?.sourceUrl ?? (key.includes('://') ? key : `https://${key}`);
        try {
            const headers = {};
            if (rangeHeader)
                headers['Range'] = rangeHeader;
            const requestHadCookie = await this.requestHadCookie(sourceUrl);
            const requestHadAuthorization = this.authByUrl.get(sourceUrl) === true;
            const res = await this.page.context().request.get(sourceUrl, { timeout: 30_000, headers });
            if (!res.ok() && res.status() !== 206)
                return null;
            const buf = Buffer.from(await res.body());
            const resHeaders = res.headers();
            const contentType = LivePageProjection.headerValue(resHeaders, 'content-type')?.split(';')[0]?.trim()
                || cached?.contentType
                || 'application/octet-stream';
            const contentRange = LivePageProjection.headerValue(resHeaders, 'content-range');
            const shareability = {
                requestHadCookie,
                requestHadAuthorization,
                cacheControl: LivePageProjection.headerValue(resHeaders, 'cache-control'),
                vary: LivePageProjection.headerValue(resHeaders, 'vary'),
            };
            // §5.12.2 — a plain (non-Range) fetch of a non-streaming resource is safe to serve
            // straight from the buffered copy on repeat same-session requests ('cache' mode);
            // Range requests and streaming/media URLs (isPassThroughUrl) always re-verify with
            // the origin ('pass-through') — never buffered-and-replayed for those (PP-ASSET-*).
            const mode = !rangeHeader && !(0, DomAssetCache_1.isPassThroughUrl)(sourceUrl, contentType) ? 'cache' : 'pass-through';
            if (!rangeHeader && buf.byteLength > 0 && buf.byteLength < 2 * 1024 * 1024) {
                this.assets.put(key, buf, contentType, { sourceUrl, mode, shareability });
            }
            return { body: buf, contentType, statusCode: res.status(), contentRange, shareability, mode };
        }
        catch {
            return null;
        }
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
    /**
     * §5.9.5 client → server control report. Visibility maps straight onto the
     * hidden rate rung (§5.3.5.3); while visible, an apply overrun or a growing
     * client backlog degrades the rate ladder one step (§5.3.5.1), otherwise a
     * recovery step is attempted (throttled internally to `rateRecoverMs`).
     */
    reportClientState(state) {
        if (this.stopped || !this.engine)
            return;
        this.engine.setHidden(state.visibility === 'hidden');
        if (state.visibility === 'hidden')
            return;
        if (state.overrunCount > 0 || state.queuedFrames > CLIENT_STATE_QUEUED_FRAMES_DEGRADE_THRESHOLD) {
            if (state.overrunCount > 0) {
                this.frameStats.applyOverrunReports += state.overrunCount;
                this.events.onParity?.('parity_frame_apply_overrun', {
                    pageEpochId: this.pageEpochId,
                    overrunCount: state.overrunCount,
                    queuedFrames: state.queuedFrames,
                    generation: this.engine.currentGeneration,
                });
            }
            this.engine.degradeRate();
        }
        else {
            this.engine.tryRecoverRate();
        }
    }
    /**
     * §5.7.2 W3 binary OOB resync — served from the Node-side mirror (never a fresh
     * page walk; never advances the live `sequence` counter). Shapes the exact same
     * `cssomInstall` → `establishBegin`/`establishChunk`×N → `establishEnd` op stream
     * `runEstablish` emits, so the client's existing establish/resync handling
     * (`ProjectionClient.applyEstablish`) re-enters through the ordinary `ingest()`
     * path with the `resync` flag set instead of `establish` — no separate JSON
     * `{ root, sheets }` shape, no V1 shim (AGENTS.md ad-hoc ban).
     */
    async captureResyncSnapshot() {
        if (this.stopped || !this.established)
            return null;
        const mirror = this.mirrorBox.mirror;
        if (!mirror || mirror.root === null)
            return null;
        const start = Date.now();
        const html = mirror.serializeToHtml();
        const { nodeCount, checksum } = (0, establish_1.computeEstablishChecksum)(mirror.collectTagsPreorder());
        const chunks = (0, establish_1.splitHtmlIntoChunks)(html, this.establishChunkBytes);
        const viewport = this.page.viewportSize() ?? { width: 0, height: 0 };
        const sheets = await this.snapshotCssomSheets();
        const documentState = await this.snapshotDocumentStateRaw();
        const generation = this.engine.currentGeneration;
        const coversThroughSequence = this.engine.currentSequence;
        const ops = [
            { op: 'cssomInstall', sheets },
            { op: 'establishBegin', payload: (0, establish_1.buildEstablishBegin)(generation, viewport, { x: 0, y: 0 }) },
            ...chunks.map((chunk) => ({ op: 'establishChunk', bytes: Buffer.from(chunk, 'utf8') })),
            { op: 'establishEnd', nodeCount, checksum },
            ...(documentState ? [documentState] : []),
        ];
        const meta = { generation, sequence: coversThroughSequence, resync: true };
        return {
            generation,
            coversThroughSequence,
            parts: (0, encode_1.encodeFrame)(ops, meta),
            pageEpochId: this.pageEpochId || undefined,
            source: 'mirror',
            serializeMs: Date.now() - start,
        };
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