"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageProjection = void 0;
exports.parseDataUrl = parseDataUrl;
exports.attachDomAssetFetch = attachDomAssetFetch;
const node_crypto_1 = require("node:crypto");
const DomAssetCache_1 = require("./DomAssetCache");
const DomTreeSerializer_1 = require("./DomTreeSerializer");
const srcsetParse_1 = require("./srcsetParse");
const parityUtil_1 = require("./parityUtil");
const VirtualEpochTelemetry_1 = require("./VirtualEpochTelemetry");
const MAX_ASSET_FETCHES_PER_DIFF = 64;
const VIRTUAL_ASSETS_PREFIX = '/w7s/virtual-assets/';
const VIRTUAL_BLOB_PREFIX = '/w7s/virtual-blob/';
const VIRTUAL_DATA_PREFIX = '/w7s/virtual-data/';
/**
 * PageProjection producer: observe → anchor → map → rewrite → emit.
 * Owns the shared Dom/Cssom `sequence`; restarts it on every generation bump.
 */
class PageProjection {
    page;
    events;
    sequence = 0;
    sequenceGeneration = 1;
    generation = 1;
    documentEpoch = null;
    /** False until first Dom/Cssom establish after the session's initial Document is ready (D4). */
    established = false;
    /**
     * Sidecar gate for page live emits (T10). Armed only after Dom `document` +
     * Cssom `install` have been materializeAndPush'd on this epoch.
     */
    liveArmed = false;
    establishInFlight = null;
    stopped = false;
    assets = new DomAssetCache_1.DomAssetCache();
    materializeChain = Promise.resolve();
    uploads = new Map();
    /** CDP session for closed-shadow pierce (T7) — declarative / pre-hook roots. */
    cdp = null;
    /** Main-frame CDP id — used to ignore Page.navigatedWithinDocument soft navs (D4). */
    mainFrameCdpId = null;
    /** Epoch observed on within-document navigation — never bump while it matches (D4). */
    softNavEpoch = null;
    /** Host iframe anchor → Chromium child frame (XO pierce). */
    chromiumPierceByAnchor = new Map();
    chromiumPierceByFrame = new WeakMap();
    /** C7: Cssom sheet ids published for each XO pierce host (teardown on swap/kill). */
    chromiumPierceSheetIds = new Map();
    chromiumPierceChain = Promise.resolve();
    /**
     * Install-ready Cssom mirror updated on every live cssom materialize.
     * OOB resync clones this instead of re-walking Virtual cssRules (C8).
     */
    cssomInstallById = new Map();
    /**
     * Install-ready Dom mirror updated after every successful Dom materialize+push.
     * OOB / resume clones this instead of remapping Virtual (DomMap ms path).
     * Fail-safe: any apply miss invalidates → next OOB remaps from the page.
     */
    domInstallRoot = null;
    /** PageEpoch parity telemetry (Virtual / Establish / Asset / Resync `parity_*` kinds). */
    pageEpochId = null;
    browserLaunchedAtMs = Date.now();
    commitAtMs = null;
    bootMarked = false;
    pendingNavigationType = null;
    firstDiffEmittedForEpoch = false;
    lastSeededSheetCount = 0;
    virtualTelemetry = null;
    constructor(page, events) {
        this.page = page;
        this.events = events;
    }
    static async start(page, events, opts) {
        const proj = new PageProjection(page, events);
        if (typeof opts?.browserLaunchedAtMs === 'number') {
            proj.browserLaunchedAtMs = opts.browserLaunchedAtMs;
        }
        await page.exposeBinding('__speculumDomEmit', (_source, payload) => {
            if (proj.stopped)
                return;
            proj.emitFromPage(payload);
        });
        await page.exposeBinding('__speculumDomScrollEchoHit', (_source, info) => {
            if (proj.stopped || !info || typeof info !== 'object')
                return;
            const o = info;
            const kind = o.kind === 'element' ? 'element' : o.kind === 'viewport' ? 'viewport' : null;
            if (!kind)
                return;
            proj.events.onScrollEchoHit?.({
                kind,
                generation: proj.generation,
                anchor: typeof o.anchor === 'string' ? o.anchor : undefined,
                scrollX: typeof o.scrollX === 'number' ? o.scrollX : undefined,
                scrollY: typeof o.scrollY === 'number' ? o.scrollY : undefined,
                scrollTop: typeof o.scrollTop === 'number' ? o.scrollTop : undefined,
                scrollLeft: typeof o.scrollLeft === 'number' ? o.scrollLeft : undefined,
            });
        });
        await page.exposeBinding('__speculumDomRequestChromiumIframePierce', (_source, anchor) => {
            if (proj.stopped || typeof anchor !== 'string' || !anchor)
                return;
            void proj.enqueueChromiumIframePierce(anchor);
        });
        await page.exposeBinding('__speculumDomChromiumIframePublish', async (_source, anchor, root, sheets) => {
            if (proj.stopped || typeof anchor !== 'string' || !anchor)
                return;
            await proj.applyChromiumIframePublish(anchor, root, sheets);
        });
        await page.exposeBinding('__speculumDomChromiumIframeTeardown', (_source, anchor) => {
            if (proj.stopped || typeof anchor !== 'string' || !anchor)
                return;
            void proj.teardownChromiumIframeCssom(anchor);
        });
        await page.addInitScript({ content: DomTreeSerializer_1.PAGE_PROJECTION_PAGE_SCRIPT });
        await page.evaluate(DomTreeSerializer_1.PAGE_PROJECTION_PAGE_SCRIPT);
        await proj.ensureClosedShadowPierce();
        // D4 single boot epoch: install observers only — first establish waits for
        // establishBoot() after the session's initial navigation settles.
        page.on('framenavigated', (frame) => {
            if (proj.stopped)
                return;
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
    notePendingNavigation(kind) {
        this.pendingNavigationType = kind;
    }
    emitParity(kind, payload) {
        this.events.onParity?.(kind, payload);
    }
    /** Build DomMapCompleted parity payload: in-page phases + CDP transfer gap. */
    domMapCompletedPayload(args) {
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
    tVirtualMs() {
        return Date.now() - this.browserLaunchedAtMs;
    }
    tSinceCommitMs() {
        return this.commitAtMs != null ? Date.now() - this.commitAtMs : undefined;
    }
    /** SoftNav SPA wipe — new pageEpochId, same generation. */
    onSoftNavCommit(url, documentEpoch) {
        const now = Date.now();
        this.pageEpochId = (0, node_crypto_1.randomUUID)();
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
    restartVirtualTelemetry() {
        if (!this.pageEpochId || this.commitAtMs == null)
            return;
        this.virtualTelemetry?.stop();
        this.virtualTelemetry = new VirtualEpochTelemetry_1.VirtualEpochTelemetry(this.page, this.pageEpochId, this.commitAtMs, (kind, payload) => this.emitParity(kind, payload), () => this.tVirtualMs());
        this.virtualTelemetry.start();
    }
    /** New Document committed for this session (real navigation, not soft-nav). */
    onNavCommit() {
        const now = Date.now();
        const isFirstCommit = this.commitAtMs === null;
        this.pageEpochId = (0, node_crypto_1.randomUUID)();
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
     * First Dom `document` + Cssom `install` for the session (D4 / C4).
     * Idempotent — safe to call from navigate settle and from late framenavigated.
     */
    async establishBoot() {
        if (this.stopped || this.established)
            return;
        if (this.establishInFlight) {
            await this.establishInFlight;
            return;
        }
        this.establishInFlight = this.doEstablishBoot();
        try {
            await this.establishInFlight;
        }
        finally {
            this.establishInFlight = null;
        }
    }
    async doEstablishBoot() {
        if (this.stopped || this.established)
            return;
        try {
            await this.page.evaluate(DomTreeSerializer_1.PAGE_PROJECTION_PAGE_SCRIPT);
            const epoch = await this.readDocumentEpoch();
            if (epoch === null)
                return;
            if (this.isBlankDocumentUrl(this.page.url()))
                return;
            this.documentEpoch = epoch;
            this.generation = 1;
            this.sequence = 0;
            this.sequenceGeneration = 1;
            this.liveArmed = false;
            this.cssomInstallById.clear();
            this.domInstallRoot = null;
            await this.page.evaluate(`typeof window.__speculumDomBumpGeneration === "function" && window.__speculumDomBumpGeneration(1)`);
            await this.ensureClosedShadowPierce();
            this.onNavCommit();
            // T10: established only after document + install are on the chain (not before).
            const armed = await this.enqueueDocumentDiff();
            if (armed)
                this.established = true;
        }
        catch {
            /* mid-navigation */
        }
    }
    async stop() {
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
            }
            catch {
                /* ignore */
            }
            this.cdp = null;
        }
    }
    /** Path-keyed or hash lookup for virtual-asset serve. */
    getAsset(key) {
        const e = this.assets.get(key);
        if (!e)
            return undefined;
        return {
            body: e.body,
            contentType: e.contentType,
            sourceUrl: e.sourceUrl,
            mode: e.mode,
        };
    }
    async fetchPassThrough(key, rangeHeader) {
        const e = this.assets.get(key);
        const sourceUrl = e?.sourceUrl ?? (key.includes('://') ? key : `https://${key}`);
        try {
            const headers = {};
            if (rangeHeader)
                headers.Range = rangeHeader;
            const res = await this.page.context().request.get(sourceUrl, {
                timeout: 30_000,
                headers,
            });
            if (!res.ok() && res.status() !== 206)
                return null;
            const buf = Buffer.from(await res.body());
            const headerCt = res.headers()['content-type'];
            const ct = (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim()
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
        }
        catch {
            return null;
        }
    }
    putUpload(id, body, contentType, name) {
        this.uploads.set(id, { body, contentType, name });
    }
    takeUpload(id) {
        const u = this.uploads.get(id);
        if (u)
            this.uploads.delete(id);
        return u;
    }
    /** Epoch id of the Document the emitter is currently installed on (D4). */
    async readDocumentEpoch() {
        const epoch = await this.page.evaluate('typeof window.__speculumDomEpochId === "function" ? window.__speculumDomEpochId() : null');
        return typeof epoch === 'string' ? epoch : null;
    }
    isBlankDocumentUrl(url) {
        const u = (url || '').trim().toLowerCase();
        return !u || u === 'about:blank' || u === 'about:newtab' || u.startsWith('chrome://');
    }
    async onMainFrameNavigated() {
        try {
            this.chromiumPierceByAnchor.clear();
            this.chromiumPierceSheetIds.clear();
            await this.page.evaluate(DomTreeSerializer_1.PAGE_PROJECTION_PAGE_SCRIPT);
            // T3/D4: framenavigated alone is not evidence of Document replacement.
            const epoch = await this.readDocumentEpoch();
            if (epoch === null)
                return;
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
            if (epoch === this.documentEpoch)
                return;
            this.documentEpoch = epoch;
            // Disarm live path until the new epoch's document + install land (T10).
            this.liveArmed = false;
            this.cssomInstallById.clear();
            this.domInstallRoot = null;
            // Sidecar owns monotonic generation — never adopt a fresh page counter (T3).
            const fromGeneration = this.generation;
            this.generation += 1;
            await this.page.evaluate(`typeof window.__speculumDomBumpGeneration === "function" && window.__speculumDomBumpGeneration(${this.generation})`);
            await this.ensureClosedShadowPierce();
            this.onNavCommit();
            this.events.onGenerationBumped?.({
                fromGeneration,
                toGeneration: this.generation,
                reason: 'main_frame_navigated',
                url: this.page.url(),
            });
            void this.enqueueDocumentDiff();
        }
        catch {
            /* mid-navigation */
        }
    }
    /**
     * T7: adopt closed shadow roots via CDP (declarative / pre-hook) into the
     * page-script WeakMap so F / MO / CSSOM pierce them like attachShadow hooks.
     */
    async ensureClosedShadowPierce() {
        if (this.stopped)
            return;
        let lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                if (!this.cdp) {
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
                            .then(async (epoch) => {
                            if (epoch)
                                this.softNavEpoch = epoch;
                            let url;
                            try {
                                url = this.page.url();
                            }
                            catch {
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
                            .catch(() => { });
                    });
                    this.cdp.on('DOM.shadowRootPushed', (ev) => {
                        if (this.stopped)
                            return;
                        if (ev.root?.shadowRootType !== 'closed')
                            return;
                        const rootId = ev.root.nodeId;
                        if (rootId == null)
                            return;
                        void this.adoptClosedShadowPair(ev.hostId, rootId, true);
                    });
                }
                await this.adoptExistingClosedShadowsFromCdp();
                return;
            }
            catch (err) {
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
    async adoptExistingClosedShadowsFromCdp() {
        if (!this.cdp || this.stopped)
            return;
        const doc = await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true });
        if (!doc.root)
            return;
        const pairs = [];
        walkCdpClosedShadows(doc.root, pairs);
        for (const pair of pairs) {
            await this.adoptClosedShadowPair(pair.hostId, pair.shadowId, false);
        }
    }
    async adoptClosedShadowPair(hostNodeId, shadowNodeId, publish) {
        if (!this.cdp || this.stopped)
            return;
        try {
            const hostResolved = await this.cdp.send('DOM.resolveNode', { nodeId: hostNodeId });
            const shadowResolved = await this.cdp.send('DOM.resolveNode', { nodeId: shadowNodeId });
            const hostId = hostResolved.object?.objectId;
            const shadowId = shadowResolved.object?.objectId;
            if (!hostId || !shadowId)
                return;
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
        }
        catch {
            /* node may have been collected mid-flight */
        }
    }
    /**
     * T7: pierce a cross-origin iframe via frame.contentFrame() + satellite map.
     */
    enqueueChromiumIframePierce(anchor) {
        this.chromiumPierceChain = this.chromiumPierceChain
            .then(() => this.pierceIframeViaChromium(anchor))
            .catch(() => undefined);
    }
    async onChildFrameNavigated(frame) {
        const anchor = this.chromiumPierceByFrame.get(frame);
        if (!anchor)
            return;
        this.enqueueChromiumIframePierce(anchor);
    }
    async pierceIframeViaChromium(anchor) {
        if (this.stopped || !anchor)
            return;
        let handle = null;
        try {
            const evaluated = await this.page.evaluateHandle((a) => {
                const w = globalThis;
                return w.__speculumDomResolve?.(a) ?? null;
            }, anchor);
            handle = evaluated.asElement();
            if (!handle) {
                await evaluated.dispose().catch(() => undefined);
                return;
            }
            const frame = await handle.contentFrame();
            if (!frame || frame === this.page.mainFrame())
                return;
            this.chromiumPierceByAnchor.set(anchor, frame);
            this.chromiumPierceByFrame.set(frame, anchor);
            await frame.evaluate(`window.__speculumPierceHostAnchor = ${JSON.stringify(anchor)};`);
            // Force reinstall on document swap (G-B) — clear prior satellite marker.
            await frame.evaluate('try { delete window.__speculumDomPierceInstalled; } catch (e) {}');
            await frame.evaluate(DomTreeSerializer_1.PAGE_PROJECTION_PAGE_SCRIPT);
            const mapped = (await frame.evaluate(`(() => {
        const root = typeof window.__speculumDomMapPierceRoot === 'function'
          ? window.__speculumDomMapPierceRoot()
          : null;
        const sheets = typeof window.__speculumDomMapPierceCssom === 'function'
          ? window.__speculumDomMapPierceCssom()
          : [];
        return { root, sheets };
      })()`));
            await this.applyChromiumIframePublish(anchor, mapped?.root ?? null, mapped?.sheets ?? []);
            // Closed shadows inside the pierce frame may now have a local adopt hook.
            await this.ensureClosedShadowPierce();
        }
        catch {
            /* frame detached / mid-navigation */
        }
        finally {
            if (handle)
                await handle.dispose().catch(() => undefined);
        }
    }
    async applyChromiumIframePublish(anchor, root, sheets) {
        if (this.stopped || !anchor || !root || typeof root !== 'object')
            return;
        const rootNode = root;
        // `null` = Dom-only remount (live MO). Array (incl. empty) = pierce establish/swap (C7).
        const sheetEstablish = Array.isArray(sheets);
        const sheetList = sheetEstablish ? sheets : null;
        this.enqueue(async () => {
            try {
                await this.rewriteRemoteAssets([rootNode]);
                const meta = (await this.page.evaluate(([a, r]) => {
                    const w = globalThis;
                    // silent: sidecar emits Dom then Cssom (C7 order).
                    return w.__speculumDomApplyChromiumIframePierce?.(a, r, true) ?? null;
                }, [anchor, rootNode]));
                if (!meta?.selector?.query)
                    return;
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
                    }
                    else {
                        this.chromiumPierceSheetIds.set(anchor, new Set());
                    }
                }
            }
            catch {
                /* ignore */
            }
        });
    }
    /** C7: host kill / XO pierce teardown — drop every sheet scoped to this host. */
    teardownChromiumIframeCssom(anchor) {
        if (!anchor)
            return;
        this.chromiumPierceByAnchor.delete(anchor);
        const prevIds = [...(this.chromiumPierceSheetIds.get(anchor) ?? [])];
        this.chromiumPierceSheetIds.delete(anchor);
        if (prevIds.length === 0)
            return;
        this.enqueue(async () => {
            await this.materializeAndPush('cssom', 'sheetList', {
                removed: prevIds.map((id) => ({ selector: { kind: 'sheet', id } })),
                added: [],
            });
        });
    }
    /** Track pierceHost sheet ids so XO swap/kill can emit C7 removes. */
    noteCssomSheetList(payload) {
        const removed = Array.isArray(payload.removed)
            ? payload.removed
            : [];
        for (const entry of removed) {
            const id = entry?.selector?.id;
            if (!id)
                continue;
            for (const set of this.chromiumPierceSheetIds.values())
                set.delete(id);
        }
        const added = Array.isArray(payload.added)
            ? payload.added
            : [];
        for (const entry of added) {
            const sheet = entry?.sheet;
            const id = sheet?.id;
            const scope = sheet?.scope;
            if (!id || scope?.kind !== 'pierceHost' || !scope.hostAnchor)
                continue;
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
    async captureResyncSnapshot() {
        if (this.stopped)
            return null;
        // Pre-establish resync would invent watermark 0 — refuse (T8 / T10).
        if (!this.established)
            return null;
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
                    let root = null;
                    let mappedTimings;
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
                    }
                    else {
                        const mapped = (await this.page.evaluate(`typeof window.__speculumDomMapDocumentResync === "function"
                ? window.__speculumDomMapDocumentResync()
                : window.__speculumDomMapDocument()`));
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
                    const approxNodes = (0, parityUtil_1.countNodesApprox)(root);
                    this.emitParity('parity_establish_dom_map_completed', this.domMapCompletedPayload({
                        pageEpochId,
                        generation: this.generation,
                        path: 'resync',
                        evaluateWallMs,
                        approxNodes,
                        timings: mappedTimings,
                        mirror: usedDomMirror,
                    }));
                    // OOB: rewrite URLs without awaiting asset bodies — pass-through warms on demand.
                    // Mirror roots are already rewritten; rewrite is then a cheap no-op pass.
                    const rewriteStartMs = Date.now();
                    await this.rewriteRemoteAssets([root], { deferFetches: true });
                    const rewriteMs = Date.now() - rewriteStartMs;
                    const cssomCloneStartMs = Date.now();
                    let sheets = this.cloneCssomInstallMirror();
                    let source = 'mirror';
                    // Cold edge: Cssom mirror empty before first install landed — one-shot dump fallback.
                    if (sheets.length === 0) {
                        source = 'dump_fallback';
                        const cssom = (await this.page.evaluate('window.__speculumDomMapCssom()'));
                        sheets = Array.isArray(cssom?.sheets) ? [...cssom.sheets] : [];
                        for (const [hostAnchor, frame] of this.chromiumPierceByAnchor) {
                            if (this.stopped)
                                break;
                            try {
                                if (frame.isDetached()) {
                                    this.chromiumPierceByAnchor.delete(hostAnchor);
                                    continue;
                                }
                                const pierceSheets = (await frame.evaluate(`typeof window.__speculumDomMapPierceCssom === "function" ? window.__speculumDomMapPierceCssom() : []`));
                                if (Array.isArray(pierceSheets))
                                    sheets.push(...pierceSheets);
                            }
                            catch {
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
                }
                catch {
                    return null;
                }
            });
            return snap;
        }
        finally {
            // T5: re-establish so paused mutations are not a silent chronology hole.
            void this.resumeLiveEmitAfterBackpressure();
        }
    }
    /**
     * @deprecated Does not publish OOB resync. Use `captureResyncSnapshot` and the
     * Watch/GetPageProjectionResync transport (T8).
     */
    async requestResync() {
        if (this.stopped)
            return null;
        return this.captureResyncSnapshot();
    }
    getGeneration() {
        return this.generation;
    }
    /**
     * T5 backpressure defer: stop page live emit while EventBridge Dom is near capacity.
     * MO keeps running; emit() no-ops until resume re-establishes.
     */
    async pauseLiveEmitForBackpressure() {
        if (this.stopped || !this.established)
            return;
        try {
            await this.page.evaluate(`typeof window.__speculumDomPauseLiveEmit === "function" && window.__speculumDomPauseLiveEmit()`);
        }
        catch {
            /* mid-nav */
        }
    }
    /**
     * After Dom queue drains: re-establish document+install so deferred mutations are not lost
     * as a silent chronology hole (T5 — overflow path stays DropAll+desync only at hard cap).
     * Hot Dom+Cssom mirrors re-push without MapAndArm; otherwise full establish remap.
     */
    async resumeLiveEmitAfterBackpressure() {
        if (this.stopped || !this.established)
            return;
        if (this.domInstallRoot && this.cssomInstallById.size > 0) {
            await this.runOnMaterializeChain(async () => {
                if (this.stopped || !this.domInstallRoot || this.cssomInstallById.size === 0) {
                    await this.enqueueDocumentDiff();
                    return;
                }
                try {
                    // Discard buffered MO (same as MapAndArm) then arm — live emits resume after re-push.
                    await this.page.evaluate(`typeof window.__speculumDomPauseLiveEmit === "function" && window.__speculumDomPauseLiveEmit();
             typeof window.__speculumDomArmLiveEmit === "function" && window.__speculumDomArmLiveEmit();`);
                }
                catch {
                    /* mid-nav — fall through to remap */
                    await this.enqueueDocumentDiff();
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
        await this.enqueueDocumentDiff();
    }
    /** Serialize work with Dom/Cssom emits so chronology stays contiguous (T8). */
    runOnMaterializeChain(work) {
        const done = this.materializeChain.then(work, work);
        this.materializeChain = done.then(() => undefined, () => undefined);
        return done;
    }
    /** C4 — wait for pending stylesheet links before install / resync map. */
    async waitStylesheetsReady(timeoutMs) {
        try {
            const result = (await this.page.evaluate(`typeof window.__speculumDomWaitStylesheetsReady === "function"
          ? window.__speculumDomWaitStylesheetsReady(${Math.max(0, timeoutMs | 0)})
          : null`));
            return { ready: result?.ready !== false };
        }
        catch {
            /* mid-navigation */
            return { ready: false };
        }
    }
    /**
     * Map Dom `document` + Cssom `install` and arm page live emit in one evaluate,
     * then push both planes. Sidecar `liveArmed` is set before push so MO that fires
     * during materialize enqueues behind document/install on the chain (T10).
     */
    enqueueDocumentDiff() {
        return new Promise((resolve) => {
            this.enqueue(async () => {
                let armed = false;
                const pageEpochId = this.pageEpochId ?? '';
                const generation = this.generation;
                const establishStartMs = Date.now();
                const stylesTimeoutMs = 2500;
                try {
                    this.liveArmed = false;
                    // C4: wait styles before Dom document so the first client paint is not a
                    // long FOUC window ahead of Cssom install.
                    this.emitParity('parity_establish_styles_wait_started', {
                        pageEpochId,
                        generation,
                        timeoutMs: stylesTimeoutMs,
                        tVirtualMs: this.tVirtualMs(),
                    });
                    const stylesStartMs = Date.now();
                    const { ready } = await this.waitStylesheetsReady(stylesTimeoutMs);
                    this.emitParity('parity_establish_styles_wait_completed', {
                        pageEpochId,
                        generation,
                        timeoutMs: stylesTimeoutMs,
                        waitedMs: Date.now() - stylesStartMs,
                        timedOut: !ready,
                        tVirtualMs: this.tVirtualMs(),
                    });
                    this.emitParity('parity_establish_dom_map_started', {
                        pageEpochId,
                        generation,
                        path: 'establish',
                        tVirtualMs: this.tVirtualMs(),
                    });
                    const domMapStartMs = Date.now();
                    const mappedRaw = (await this.page.evaluate(`typeof window.__speculumDomMapAndArmEstablish === "function"
              ? window.__speculumDomMapAndArmEstablish()
              : null`));
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
                    this.emitParity('parity_establish_dom_map_completed', this.domMapCompletedPayload({
                        pageEpochId,
                        generation,
                        path: 'establish',
                        evaluateWallMs,
                        approxNodes: (0, parityUtil_1.countNodesApprox)(mapped.root),
                        timings: mapped.timings,
                    }));
                    // Accept page MO immediately; emitFromPage enqueues behind this task.
                    this.liveArmed = true;
                    await this.materializeAndPush('dom', 'document', { root: mapped.root });
                    this.noteFirstDiffEmitted('dom', 'document');
                    if (Array.isArray(mapped.sheets)) {
                        this.emitParity('parity_establish_cssom_install_started', {
                            pageEpochId,
                            generation,
                            source: 'live',
                            tVirtualMs: this.tVirtualMs(),
                        });
                        const cssomStartMs = Date.now();
                        this.lastSeededSheetCount = 0;
                        await this.materializeAndPush('cssom', 'install', { sheets: mapped.sheets });
                        const { sheetCount, ruleCount } = (0, parityUtil_1.summarizeSheets)(mapped.sheets);
                        this.emitParity('parity_establish_cssom_install_completed', {
                            pageEpochId,
                            generation,
                            source: 'live',
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
                    });
                }
                catch (err) {
                    this.liveArmed = false;
                    this.emitParity('parity_establish_failed', {
                        pageEpochId,
                        generation,
                        errorCode: 'establish_exception',
                        phase: 'establish',
                        message: err instanceof Error ? err.message.slice(0, 256) : String(err).slice(0, 256),
                        tVirtualMs: this.tVirtualMs(),
                    });
                }
                finally {
                    resolve(armed);
                }
            });
        });
    }
    /** Fires once per epoch — marks the first Dom/Cssom diff that reaches the wire. */
    noteFirstDiffEmitted(plane, operation) {
        if (this.firstDiffEmittedForEpoch)
            return;
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
    emitFromPage(emitted) {
        // T10: drop live page traffic until document + install armed this epoch.
        if (!this.liveArmed)
            return;
        if (!emitted || typeof emitted !== 'object')
            return;
        const p = emitted;
        const plane = p.plane === 'cssom' ? 'cssom' : p.plane === 'dom' ? 'dom' : null;
        const operation = typeof p.operation === 'string' ? p.operation.trim() : '';
        if (!plane || !operation || !p.payload || typeof p.payload !== 'object')
            return;
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
    enqueue(work) {
        this.materializeChain = this.materializeChain.then(work).catch(() => { });
    }
    async materializeAndPush(plane, operation, payload) {
        if (this.stopped)
            return;
        if (plane === 'dom') {
            await this.rewriteDomPayload(operation, payload);
        }
        else {
            await this.seedCssomSheets(operation, payload);
            this.rewriteCssomPayload(operation, payload);
            this.updateCssomInstallMirror(operation, payload);
            if (operation === 'sheetList')
                this.noteCssomSheetList(payload);
        }
        if (this.stopped)
            return;
        this.push(plane, operation, payload);
        // Dom mirror after push so LMS stamp is included (same bytes as the wire).
        if (plane === 'dom')
            this.updateDomInstallMirror(operation, payload);
    }
    cloneDomInstallMirror() {
        return this.domInstallRoot ? structuredClone(this.domInstallRoot) : null;
    }
    invalidateDomInstallMirror(reason, detail) {
        void reason;
        void detail;
        this.domInstallRoot = null;
    }
    /**
     * Keep OOB Dom mirror in lockstep with live Dom wire state.
     * Fail-safe: any apply miss drops the mirror → next OOB remaps from Virtual.
     */
    updateDomInstallMirror(operation, payload) {
        if (operation === 'document') {
            const root = payload.root;
            if (root && typeof root === 'object' && typeof root.tag === 'string') {
                this.domInstallRoot = structuredClone(root);
            }
            else {
                this.invalidateDomInstallMirror('document_empty');
            }
            return;
        }
        if (!this.domInstallRoot)
            return;
        if (operation === 'scrollViewport' || operation === 'scrollElement')
            return;
        if (operation === 'childList') {
            const applied = applyDomMirrorChildList(this.domInstallRoot, payload);
            if (!applied.ok) {
                const sel = payload.selector;
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
    cloneCssomInstallMirror() {
        return structuredClone([...this.cssomInstallById.values()]);
    }
    replaceCssomInstallMirror(sheets) {
        this.cssomInstallById.clear();
        for (const sheet of sheets) {
            const id = typeof sheet?.id === 'string' ? sheet.id : '';
            if (!id)
                continue;
            this.cssomInstallById.set(id, structuredClone(sheet));
        }
    }
    /** Keep OOB install mirror in lockstep with live Cssom wire state (C8). */
    updateCssomInstallMirror(operation, payload) {
        if (operation === 'install' && Array.isArray(payload.sheets)) {
            this.replaceCssomInstallMirror(payload.sheets);
            return;
        }
        if (operation === 'sheetList') {
            const removed = Array.isArray(payload.removed) ? payload.removed : [];
            for (const id of removed)
                this.cssomInstallById.delete(String(id));
            const added = Array.isArray(payload.added)
                ? payload.added
                : [];
            for (const entry of added) {
                const sheet = entry?.sheet;
                const id = typeof sheet?.id === 'string' ? sheet.id : '';
                if (!id || !sheet)
                    continue;
                this.cssomInstallById.set(id, structuredClone(sheet));
            }
            return;
        }
        if (operation === 'ruleList') {
            const sheetId = payload.selector && typeof payload.selector === 'object'
                ? String(payload.selector.id ?? '')
                : '';
            const sheet = sheetId ? this.cssomInstallById.get(sheetId) : undefined;
            if (!sheet)
                return;
            const removed = Array.isArray(payload.removed) ? payload.removed : [];
            if (removed.length && Array.isArray(sheet.rules)) {
                const drop = new Set(removed.map(String));
                sheet.rules = sheet.rules.filter((r) => !drop.has(String(r.id ?? '')));
            }
            const added = Array.isArray(payload.added)
                ? payload.added
                : [];
            if (!Array.isArray(sheet.rules))
                sheet.rules = [];
            for (const entry of added) {
                const rule = entry?.rule;
                if (!rule || typeof rule.id !== 'string' || !rule.id)
                    continue;
                sheet.rules.push(structuredClone(rule));
            }
            return;
        }
        if (operation === 'patch') {
            const ruleId = payload.selector && typeof payload.selector === 'object'
                ? String(payload.selector.id ?? '')
                : typeof payload.rule?.id === 'string'
                    ? String(payload.rule.id)
                    : '';
            const next = payload.rule;
            if (!ruleId || !next)
                return;
            for (const sheet of this.cssomInstallById.values()) {
                const rules = sheet.rules;
                if (!Array.isArray(rules))
                    continue;
                const idx = rules.findIndex((r) => String(r.id ?? '') === ruleId);
                if (idx < 0)
                    continue;
                rules[idx] = structuredClone({ ...rules[idx], ...next, id: ruleId });
                return;
            }
        }
    }
    /**
     * C6.5 — when cssRules were CORS-blocked, fill empty sheets from the asset
     * cache (awaiting fetch). `href` is sidecar-local and stripped before wire.
     */
    async seedCssomSheets(operation, payload) {
        const targets = [];
        if (operation === 'install' && Array.isArray(payload.sheets)) {
            targets.push(...payload.sheets);
        }
        else if (operation === 'sheetList' && Array.isArray(payload.added)) {
            for (const entry of payload.added) {
                if (entry?.sheet)
                    targets.push(entry.sheet);
            }
        }
        for (const sheet of targets) {
            if (!sheet)
                continue;
            const href = typeof sheet.href === 'string' ? sheet.href : '';
            delete sheet.href;
            if (Array.isArray(sheet.rules) && sheet.rules.length > 0)
                continue;
            if (!href || !/^https?:\/\//i.test(href))
                continue;
            const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(href);
            if (!key)
                continue;
            await this.kickFetch(href, key);
            const entry = this.assets.get(key);
            if (!entry?.body?.byteLength)
                continue;
            const css = entry.body.toString('utf8');
            if (!css.trim())
                continue;
            const sheetId = typeof sheet.id === 'string' && sheet.id ? sheet.id : key;
            sheet.rules = [{ id: `seed:${sheetId}`, cssText: css }];
            this.lastSeededSheetCount += 1;
        }
    }
    /** Virtual stamps a local counter; the official sequence lands here. */
    stampLmsInPayload(payload, sequence) {
        const stampNode = (node) => {
            if (!node || typeof node !== 'object')
                return;
            const n = node;
            if (n.tag && n.tag !== '#text') {
                n.attrs = { ...(n.attrs ?? {}), 'speculum-last-mutation-sequence': String(sequence) };
            }
            for (const c of n.children ?? [])
                stampNode(c);
        };
        if (payload.root)
            stampNode(payload.root);
        if (payload.node)
            stampNode(payload.node);
        if (Array.isArray(payload.added)) {
            for (const entry of payload.added) {
                if (entry?.node)
                    stampNode(entry.node);
            }
        }
    }
    async rewriteDomPayload(operation, payload) {
        const nodes = [];
        if (operation === 'document' && payload.root) {
            nodes.push(payload.root);
        }
        else if (operation === 'childList' && Array.isArray(payload.added)) {
            for (const entry of payload.added) {
                if (entry?.node)
                    nodes.push(entry.node);
            }
        }
        else if (operation === 'patch' && payload.node) {
            nodes.push(payload.node);
        }
        if (!nodes.length)
            return;
        await this.rewriteRemoteAssets(nodes);
    }
    rewriteCssomPayload(operation, payload) {
        const rewriteRule = (rule) => {
            if (rule && typeof rule.cssText === 'string') {
                rule.cssText = this.rewriteCssTextAssets(rule.cssText);
            }
        };
        const rewriteSheet = (sheet) => {
            for (const rule of sheet?.rules ?? [])
                rewriteRule(rule);
        };
        if (operation === 'install' && Array.isArray(payload.sheets)) {
            for (const sheet of payload.sheets) {
                rewriteSheet(sheet);
            }
            return;
        }
        if (operation === 'sheetList' && Array.isArray(payload.added)) {
            for (const entry of payload.added) {
                rewriteSheet(entry?.sheet);
            }
            return;
        }
        if (operation === 'ruleList' && Array.isArray(payload.added)) {
            for (const entry of payload.added) {
                rewriteRule(entry?.rule);
            }
            return;
        }
        if (operation === 'patch') {
            rewriteRule(payload.rule);
        }
    }
    /** Absolutize + virtualize `url(...)` / `@import "..."` inside rule text, warming the cache. */
    rewriteCssTextAssets(cssText) {
        let pageBase = 'https://invalid.local/';
        try {
            pageBase = this.page.url() || pageBase;
        }
        catch {
            /* */
        }
        const foldUrl = (raw) => {
            const trimmed = raw.trim();
            if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/'))
                return null;
            let abs = trimmed;
            if (!/^https?:\/\//i.test(abs)) {
                try {
                    abs = new URL(trimmed, pageBase).href;
                }
                catch {
                    return null;
                }
            }
            if (!/^https?:\/\//i.test(abs))
                return null;
            const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(abs);
            if (!key)
                return null;
            void this.kickFetch(abs, key);
            return `${VIRTUAL_ASSETS_PREFIX}${key}`;
        };
        let out = cssText.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
            const mapped = foldUrl(raw);
            return mapped ? `url(${quote}${mapped}${quote})` : match;
        });
        // Bare-string @import "x" (not url()) — CSS engine fetches these without our auth stamp.
        out = out.replace(/@import\s+(?!url\()(['"])([^'"]+)\1/gi, (match, quote, raw) => {
            const mapped = foldUrl(raw);
            return mapped ? `@import ${quote}${mapped}${quote}` : match;
        });
        return out;
    }
    async kickFetch(url, key) {
        const startMs = Date.now();
        let mode = 'cache';
        let bytes = 0;
        let ok = false;
        try {
            if ((0, DomAssetCache_1.isPassThroughUrl)(url)) {
                this.assets.registerPassThrough(key, url);
                mode = 'pass-through';
                ok = true;
                return;
            }
            const res = await this.page.context().request.get(url, { timeout: 10_000 });
            if (!res.ok())
                return;
            const bufRaw = Buffer.from(await res.body());
            const headerCt = res.headers()['content-type'];
            let ct = (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim()
                || guessContentType(url)
                || 'application/octet-stream';
            let buf = bufRaw;
            if (ct.includes('text/css')) {
                const css = absolutizeCssUrls(bufRaw.toString('utf8'), url);
                const rewritten = rewriteCssUrlsToVirtual(css);
                buf = Buffer.from(rewritten, 'utf8');
            }
            else if (ct.includes('mpegurl')
                || ct.includes('dash+xml')
                || /\.m3u8(\?|$)/i.test(url)
                || /\.mpd(\?|$)/i.test(url)) {
                buf = Buffer.from(rewriteManifestUrls(bufRaw.toString('utf8'), url), 'utf8');
                ct = ct.includes('dash') ? 'application/dash+xml' : 'application/vnd.apple.mpegurl';
            }
            bytes = buf.byteLength;
            ok = true;
            if ((0, DomAssetCache_1.isPassThroughUrl)(url, ct)) {
                mode = 'pass-through';
                this.assets.registerPassThrough(key, url, ct);
                // Still cache a copy when small enough for warm serve.
                this.assets.put(key, buf, ct, { sourceUrl: url, mode: 'pass-through' });
            }
            else {
                this.assets.put(key, buf, ct, { sourceUrl: url, mode: 'cache' });
            }
        }
        catch {
            /* optional */
        }
        finally {
            const durationMs = Date.now() - startMs;
            if (durationMs > 100) {
                this.emitParity('parity_asset_fetch_finished', {
                    pageEpochId: this.pageEpochId ?? '',
                    urlKey: (0, parityUtil_1.urlKeyOf)(url),
                    durationMs,
                    bytes,
                    mode,
                    ok,
                    tVirtualMs: this.tVirtualMs(),
                });
            }
        }
    }
    async rewriteRemoteAssets(nodes, opts) {
        const candidates = [];
        const seen = new Set();
        let bareSkipped = 0;
        let dataInlined = 0;
        let blobQueued = 0;
        let deferredFetches = 0;
        let rewritten = 0;
        let pageBase = 'https://invalid.local/';
        try {
            pageBase = this.page.url() || pageBase;
        }
        catch {
            /* */
        }
        const absolutize = (raw) => {
            const t = raw.trim();
            if (!t || t.startsWith('/w7s/') || t.startsWith('data:') || t.startsWith('blob:'))
                return t;
            if (/^https?:\/\//i.test(t))
                return t;
            try {
                return new URL(t, pageBase).href;
            }
            catch {
                return t;
            }
        };
        const consider = (raw, tag, attrs, attrName) => {
            if (!raw || seen.has(raw))
                return;
            if (raw.startsWith('/w7s/'))
                return;
            // Never virtualize document navigations — a stamped/unstamped virtual href
            // would navigate the Speculum Live SPA off the mirror (401 / white screen).
            if (attrName && isDocumentNavigationAttr(attrName, tag, attrs))
                return;
            if (raw.startsWith('blob:') || raw.startsWith('data:')) {
                seen.add(raw);
                candidates.push({ url: raw, priority: 60 });
                return;
            }
            const url = absolutize(raw);
            if (seen.has(url))
                return;
            if (!/^https?:\/\//i.test(url))
                return;
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
        const walk = (node) => {
            if (!node)
                return;
            if (node.attrs) {
                for (const key of ['href', 'src', 'poster', 'srcset', 'imagesrcset', 'data-src', 'action', 'formaction']) {
                    const v = node.attrs[key];
                    if (!v)
                        continue;
                    if (key === 'srcset' || key === 'imagesrcset') {
                        for (const part of (0, srcsetParse_1.parseSrcset)(v)) {
                            consider(part.url, node.tag, node.attrs, key);
                        }
                    }
                    else {
                        consider(v, node.tag, node.attrs, key);
                    }
                }
                if (node.attrs['style']) {
                    for (const m of node.attrs['style'].matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) {
                        consider(m[2], node.tag, node.attrs);
                    }
                }
            }
            for (const child of node.children ?? [])
                walk(child);
        };
        for (const n of nodes)
            walk(n);
        const urlToVirtual = new Map();
        for (const { url } of candidates) {
            if (url.startsWith('data:')) {
                const parsed = parseDataUrl(url);
                // Never invent /w7s/virtual-data/... without a successful ingest put.
                if (!parsed)
                    continue;
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
            const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(url);
            if (!key)
                continue;
            urlToVirtual.set(url, VIRTUAL_ASSETS_PREFIX + key);
        }
        // Also map original relative forms that absolutize to the same https URL.
        const rewriteLookup = (raw) => {
            if (urlToVirtual.has(raw))
                return urlToVirtual.get(raw);
            const abs = absolutize(raw);
            return urlToVirtual.get(abs);
        };
        candidates.sort((a, b) => b.priority - a.priority);
        const limited = candidates.slice(0, MAX_ASSET_FETCHES_PER_DIFF);
        const defer = opts?.deferFetches === true;
        const cssFetches = [];
        const eagerImgFetches = [];
        for (const { url, priority } of limited) {
            if (url.startsWith('data:') || url.startsWith('blob:'))
                continue;
            const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(url);
            if (!key)
                continue;
            if (defer) {
                void this.kickFetch(url, key);
                deferredFetches += 1;
                continue;
            }
            // Stylesheets must land before Cssom install seeds from the cache (C6.5).
            if (priority >= 90) {
                cssFetches.push(this.kickFetch(url, key));
            }
            else if (priority >= 50 && eagerImgFetches.length < 8) {
                // Cap eager imgs so Dom establish stays responsive while chrome icons warm.
                eagerImgFetches.push(this.kickFetch(url, key));
            }
            else {
                void this.kickFetch(url, key);
            }
        }
        if (!defer && (cssFetches.length || eagerImgFetches.length)) {
            await Promise.all([...cssFetches, ...eagerImgFetches]);
        }
        if (urlToVirtual.size > 0) {
            const rewriteNode = (node) => {
                if (!node?.attrs)
                    return;
                for (const key of Object.keys(node.attrs)) {
                    const v = node.attrs[key];
                    if (!v)
                        continue;
                    if (isDocumentNavigationAttr(key, node.tag, node.attrs))
                        continue;
                    if (key === 'srcset' || key === 'imagesrcset') {
                        node.attrs[key] = (0, srcsetParse_1.mapSrcset)(v, (u) => rewriteLookup(u) ?? u);
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
                            if (m)
                                rewritten += 1;
                            return m ? `url(${q}${m}${q})` : full;
                        });
                    }
                }
                for (const child of node.children ?? [])
                    rewriteNode(child);
            };
            for (const n of nodes)
                rewriteNode(n);
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
    async ingestBlob(blobUrl, id) {
        try {
            const hit = await this.page.evaluate(async (url) => {
                try {
                    const res = await fetch(url);
                    if (!res.ok)
                        return null;
                    const ct = res.headers.get('content-type') || 'application/octet-stream';
                    const buf = new Uint8Array(await res.arrayBuffer());
                    let binary = '';
                    const chunk = 0x8000;
                    for (let i = 0; i < buf.length; i += chunk) {
                        binary += String.fromCharCode(...buf.subarray(i, i + chunk));
                    }
                    return { contentType: ct, base64: btoa(binary) };
                }
                catch {
                    return null;
                }
            }, blobUrl);
            if (!hit?.base64)
                return;
            this.assets.putBlob(id, Buffer.from(hit.base64, 'base64'), hit.contentType);
        }
        catch {
            /* optional */
        }
    }
    push(plane, operation, payload) {
        if (this.sequenceGeneration !== this.generation) {
            this.sequenceGeneration = this.generation;
            this.sequence = 0;
        }
        this.sequence += 1;
        if (plane === 'dom')
            this.stampLmsInPayload(payload, this.sequence);
        this.events.onPageProjectionDiff({
            sequence: this.sequence,
            generation: this.generation,
            plane,
            operation,
            timestampMs: Date.now(),
            body: (0, DomTreeSerializer_1.encodeDomBody)(payload),
        });
    }
}
exports.PageProjection = PageProjection;
function createInlineId(s) {
    return (0, node_crypto_1.createHash)('sha256').update(s).digest('hex').slice(0, 24);
}
/** Parse DomMap evaluate result — prefers in-page `rootJson`/`sheetsJson` scalars. */
function parseMappedDomEvaluate(raw) {
    if (!raw || typeof raw !== 'object') {
        return { root: null };
    }
    let root = null;
    const rootJson = raw.rootJson;
    if (typeof rootJson === 'string' && rootJson.length > 0) {
        try {
            const parsed = JSON.parse(rootJson);
            if (parsed && typeof parsed === 'object' && typeof parsed.tag === 'string')
                root = parsed;
        }
        catch {
            root = null;
        }
    }
    else if (raw.root && typeof raw.root === 'object') {
        root = raw.root;
    }
    let sheets;
    const sheetsJson = raw.sheetsJson;
    if (typeof sheetsJson === 'string' && sheetsJson.length > 0) {
        try {
            const parsed = JSON.parse(sheetsJson);
            if (Array.isArray(parsed))
                sheets = parsed;
        }
        catch {
            sheets = undefined;
        }
    }
    else if (Array.isArray(raw.sheets)) {
        sheets = raw.sheets;
    }
    return {
        generation: typeof raw.generation === 'number' ? raw.generation : undefined,
        root,
        sheets,
        timings: (raw.timings && typeof raw.timings === 'object'
            ? raw.timings
            : undefined),
    };
}
function unescapeCssAnchor(value) {
    return value.replace(/\\(.)/g, '$1');
}
/** Extract `speculum-anchor` from a single `[speculum-anchor="…"]` segment. */
function anchorFromElementQuery(query) {
    const m = /^\[speculum-anchor=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\]$/i.exec(query.trim());
    if (!m)
        return null;
    return unescapeCssAnchor(m[1] ?? m[2] ?? '');
}
function nodeAnchor(node) {
    const a = node.anchor || node.attrs?.['speculum-anchor'];
    return typeof a === 'string' && a ? a : null;
}
function findDomMirrorByAnchor(root, anchor) {
    if (!anchor)
        return null;
    if (nodeAnchor(root) === anchor)
        return root;
    for (const child of root.children ?? []) {
        const hit = findDomMirrorByAnchor(child, anchor);
        if (hit)
            return hit;
    }
    return null;
}
function findDomMirrorByTag(root, tag) {
    const want = tag.toLowerCase();
    if ((root.tag || '').toLowerCase() === want)
        return root;
    for (const child of root.children ?? []) {
        if (child.tag === '#text' || child.tag === '#comment')
            continue;
        const hit = findDomMirrorByTag(child, want);
        if (hit)
            return hit;
    }
    return null;
}
/**
 * Resolve wire `query` against DomNodeJson — supports
 * `[speculum-anchor="…"]` and compound `… > :nth-child(n)` (element-only steps),
 * plus legacy `html|body|head` roots.
 */
function resolveDomMirrorQuery(root, query) {
    const parts = query
        .split(/\s*>\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
    if (!parts.length)
        return null;
    const first = parts[0];
    let cur = null;
    const firstAnchor = anchorFromElementQuery(first);
    if (firstAnchor) {
        cur = findDomMirrorByAnchor(root, firstAnchor);
    }
    else if (/^(html|body|head)$/i.test(first)) {
        cur = findDomMirrorByTag(root, first);
    }
    else {
        return null;
    }
    if (!cur)
        return null;
    for (let i = 1; i < parts.length; i++) {
        const step = parts[i];
        const m = /^:nth-child\((\d+)\)$/i.exec(step);
        if (!m)
            return null;
        const n = Number(m[1]);
        if (!Number.isFinite(n) || n < 1)
            return null;
        // Writer nth-child space = F element siblings only (skip text/comment).
        let seen = 0;
        let hit = null;
        const kids = cur.children ?? [];
        for (const child of kids) {
            if (child.tag === '#text' || child.tag === '#comment')
                continue;
            seen += 1;
            if (seen === n) {
                hit = child;
                break;
            }
        }
        if (!hit)
            return null;
        cur = hit;
    }
    return cur;
}
function resolveDomMirrorParent(root, selector) {
    if (!selector || typeof selector.query !== 'string')
        return null;
    const kind = selector.kind === 'childAt' ? 'childAt' : 'element';
    const el = resolveDomMirrorQuery(root, selector.query);
    if (!el)
        return null;
    if (kind === 'element')
        return el;
    const index = Number(selector.index);
    if (!Number.isFinite(index) || index < 0)
        return null;
    const kids = el.children ?? [];
    return kids[index] ?? null;
}
function applyDomMirrorChildList(root, payload) {
    const selector = payload.selector;
    const parent = resolveDomMirrorParent(root, {
        kind: 'element',
        query: typeof selector?.query === 'string' ? selector.query : undefined,
    });
    if (!parent || typeof parent.tag !== 'string' || parent.tag === '#text' || parent.tag === '#comment') {
        return { ok: false, reason: 'parent_miss' };
    }
    if (!Array.isArray(parent.children))
        parent.children = [];
    const removed = Array.isArray(payload.removed)
        ? payload.removed
        : [];
    const removeIndexes = new Set();
    for (const entry of removed) {
        const sel = entry?.selector;
        if (!sel || typeof sel.query !== 'string')
            continue;
        if (sel.kind === 'childAt') {
            const idx = Number(sel.index);
            // Soft-skip oob removes (mirror shorter than live F-space) — keep mirror hot.
            if (!Number.isFinite(idx) || idx < 0 || idx >= parent.children.length)
                continue;
            removeIndexes.add(idx);
            continue;
        }
        const target = resolveDomMirrorQuery(root, sel.query);
        if (!target)
            continue; // already absent in mirror
        const idx = parent.children.indexOf(target);
        if (idx < 0) {
            // Present elsewhere under root but not as direct F-child — structural drift.
            return { ok: false, reason: `removed_not_direct_child:${sel.query.slice(0, 80)}` };
        }
        removeIndexes.add(idx);
    }
    const added = Array.isArray(payload.added)
        ? [...payload.added].sort((a, b) => Number(a.index) - Number(b.index))
        : [];
    for (const entry of added) {
        if (!entry?.node || typeof entry.node !== 'object') {
            return { ok: false, reason: 'added_bad_node' };
        }
    }
    const sortedRemove = [...removeIndexes].sort((a, b) => b - a);
    for (const idx of sortedRemove) {
        if (idx < 0 || idx >= parent.children.length)
            continue;
        parent.children.splice(idx, 1);
    }
    for (const entry of added) {
        let idx = Number(entry.index);
        if (!Number.isFinite(idx) || idx < 0)
            idx = parent.children.length;
        if (idx > parent.children.length)
            idx = parent.children.length;
        parent.children.splice(idx, 0, structuredClone(entry.node));
    }
    return { ok: true };
}
function applyDomMirrorPatch(root, payload) {
    const selector = payload.selector;
    const node = payload.node;
    if (!node || typeof node !== 'object')
        return false;
    if (!selector || typeof selector.query !== 'string')
        return false;
    if (selector.kind === 'childAt') {
        const parent = resolveDomMirrorQuery(root, selector.query);
        if (!parent)
            return false;
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
    if (!target)
        return false;
    if (typeof node.tag === 'string' && node.tag)
        target.tag = node.tag;
    if (node.attrs && typeof node.attrs === 'object') {
        target.attrs = { ...node.attrs };
    }
    if (typeof node.anchor === 'string')
        target.anchor = node.anchor;
    if (typeof node.text === 'string')
        target.text = node.text;
    return true;
}
function safePageUrl(page) {
    try {
        return page.url();
    }
    catch {
        return undefined;
    }
}
function parseDataUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('data:'))
        return null;
    const comma = url.indexOf(',');
    if (comma < 5)
        return null;
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
        if (b64 && data.replace(/\s/g, '').length > 0 && body.length === 0)
            return null;
        return { body, contentType };
    }
    catch {
        return null;
    }
}
function rewriteCssUrlsToVirtual(css) {
    let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/'))
            return match;
        if (!/^https?:\/\//i.test(trimmed))
            return match;
        if (isBareDocumentUrl(trimmed))
            return match;
        const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(trimmed);
        if (!key)
            return match;
        return `url(${quote}${VIRTUAL_ASSETS_PREFIX}${key}${quote})`;
    });
    out = out.replace(/@import\s+(?!url\()(['"])([^'"]+)\1/gi, (match, quote, raw) => {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/'))
            return match;
        if (!/^https?:\/\//i.test(trimmed))
            return match;
        if (isBareDocumentUrl(trimmed))
            return match;
        const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(trimmed);
        if (!key)
            return match;
        return `@import ${quote}${VIRTUAL_ASSETS_PREFIX}${key}${quote}`;
    });
    return out;
}
/** True for attrs that navigate the browsing context (must stay absolute https). */
function isDocumentNavigationAttr(attrName, tag, attrs) {
    const key = attrName.toLowerCase();
    if (key === 'action' || key === 'formaction')
        return true;
    if (key !== 'href')
        return false;
    const t = (tag ?? '').toLowerCase();
    if (t === 'a' || t === 'area')
        return true;
    if (t === 'link') {
        const rel = (attrs?.rel ?? '').toLowerCase();
        // Asset-like link rels stay virtualized.
        if (rel.includes('stylesheet')
            || rel.includes('icon')
            || rel.includes('preload')
            || rel.includes('modulepreload')
            || rel.includes('manifest')
            || rel.includes('apple-touch-icon')) {
            return false;
        }
        return true;
    }
    return false;
}
/** Origin root or trailing-slash path with no asset extension — do not virtualize. */
function isBareDocumentUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return false;
        const p = u.pathname || '/';
        if (p === '/')
            return true;
        if (!p.endsWith('/'))
            return false;
        return !/\.[a-z0-9]{1,8}\//i.test(p);
    }
    catch {
        return false;
    }
}
function rewriteManifestUrls(body, baseUrl) {
    return body
        .split('\n')
        .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            // Rewrite URI="..." inside HLS tags.
            return line.replace(/URI="([^"]+)"/gi, (_m, raw) => {
                try {
                    const abs = new URL(raw, baseUrl).href;
                    const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(abs);
                    return key ? `URI="${VIRTUAL_ASSETS_PREFIX}${key}"` : _m;
                }
                catch {
                    return _m;
                }
            });
        }
        try {
            const abs = new URL(trimmed, baseUrl).href;
            const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(abs);
            return key ? `${VIRTUAL_ASSETS_PREFIX}${key}` : line;
        }
        catch {
            return line;
        }
    })
        .join('\n');
}
function assetFetchPriority(url, tag, attrs) {
    const rel = (attrs?.rel ?? '').toLowerCase();
    if (tag === 'link' && (rel.includes('stylesheet') || /\.css(\?|$)/i.test(url)))
        return 100;
    if (/\.css(\?|$)/i.test(url))
        return 90;
    if (tag === 'img')
        return 50;
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url))
        return 40;
    if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url))
        return 20;
    if ((0, DomAssetCache_1.isPassThroughUrl)(url))
        return 30;
    return 10;
}
function absolutizeCssUrls(css, baseUrl) {
    return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
        const trimmed = raw.trim();
        if (!trimmed
            || trimmed.startsWith('data:')
            || trimmed.startsWith('http://')
            || trimmed.startsWith('https://')
            || trimmed.startsWith('/w7s/')) {
            return match;
        }
        try {
            return `url(${quote}${new URL(trimmed, baseUrl).href}${quote})`;
        }
        catch {
            return match;
        }
    });
}
function guessContentType(url) {
    const path = url.split('?')[0].toLowerCase();
    if (path.endsWith('.css'))
        return 'text/css';
    if (path.endsWith('.js'))
        return 'application/javascript';
    if (path.endsWith('.svg'))
        return 'image/svg+xml';
    if (path.endsWith('.png'))
        return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg'))
        return 'image/jpeg';
    if (path.endsWith('.webp'))
        return 'image/webp';
    if (path.endsWith('.woff2'))
        return 'font/woff2';
    if (path.endsWith('.woff'))
        return 'font/woff';
    if (path.endsWith('.mp4'))
        return 'video/mp4';
    if (path.endsWith('.webm'))
        return 'video/webm';
    if (path.endsWith('.m3u8'))
        return 'application/vnd.apple.mpegurl';
    return null;
}
function walkCdpClosedShadows(node, out) {
    const hostId = node.nodeId;
    if (hostId != null && Array.isArray(node.shadowRoots)) {
        for (const sr of node.shadowRoots) {
            if (sr.shadowRootType === 'closed' && sr.nodeId != null) {
                out.push({ hostId, shadowId: sr.nodeId });
            }
            walkCdpClosedShadows(sr, out);
        }
    }
    if (node.contentDocument)
        walkCdpClosedShadows(node.contentDocument, out);
    if (Array.isArray(node.children)) {
        for (const child of node.children)
            walkCdpClosedShadows(child, out);
    }
}
/** Optional CDP Fetch hook — do not enable alongside Navigation Fetch.guard. */
async function attachDomAssetFetch(cdp, _put) {
    return async () => {
        void cdp;
    };
}
//# sourceMappingURL=PageProjection.js.map