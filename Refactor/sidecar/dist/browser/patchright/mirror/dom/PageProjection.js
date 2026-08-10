"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageProjection = void 0;
exports.attachDomAssetFetch = attachDomAssetFetch;
const node_crypto_1 = require("node:crypto");
const DomAssetCache_1 = require("./DomAssetCache");
const DomTreeSerializer_1 = require("./DomTreeSerializer");
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
    constructor(page, events) {
        this.page = page;
        this.events = events;
    }
    static async start(page, events) {
        const proj = new PageProjection(page, events);
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
            await this.page.evaluate(`typeof window.__speculumDomBumpGeneration === "function" && window.__speculumDomBumpGeneration(1)`);
            await this.ensureClosedShadowPierce();
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
            // Sidecar owns monotonic generation — never adopt a fresh page counter (T3).
            const fromGeneration = this.generation;
            this.generation += 1;
            await this.page.evaluate(`typeof window.__speculumDomBumpGeneration === "function" && window.__speculumDomBumpGeneration(${this.generation})`);
            await this.ensureClosedShadowPierce();
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
     * Live pipe continues with its own chronology; client applies this watermarked body.
     * Capture runs on `materializeChain` so live `push` cannot interleave (truthful watermark).
     */
    async captureResyncSnapshot() {
        if (this.stopped)
            return null;
        // Pre-establish resync would invent watermark 0 — refuse (T8 / T10).
        if (!this.established)
            return null;
        return this.runOnMaterializeChain(async () => {
            try {
                // Do not waitStylesheetsReady here — holding the chain for seconds lets
                // Virtual mutate while emits queue, then clients storm-resync (T8).
                // MapDocument takes MO records + resets publishedAnchors to the snapshot.
                const mapped = (await this.page.evaluate('window.__speculumDomMapDocument()'));
                if (!mapped?.root)
                    return null;
                // Generation SoT is the sidecar counter — do not adopt a reset page value.
                await this.rewriteRemoteAssets([mapped.root]);
                const cssom = (await this.page.evaluate('window.__speculumDomMapCssom()'));
                const sheets = Array.isArray(cssom?.sheets) ? [...cssom.sheets] : [];
                // C7/C8: joint resync must include XO pierce-scoped sheets (top map cannot see them).
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
                return {
                    generation: this.generation,
                    // Watermark after map+seed under the same chain turn — no concurrent push.
                    coversThroughSequence: this.sequence,
                    root: mapped.root,
                    sheets,
                };
            }
            catch {
                return null;
            }
        });
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
    /** Serialize work with Dom/Cssom emits so chronology stays contiguous (T8). */
    runOnMaterializeChain(work) {
        const done = this.materializeChain.then(work, work);
        this.materializeChain = done.then(() => undefined, () => undefined);
        return done;
    }
    /** C4 — wait for pending stylesheet links before install / resync map. */
    async waitStylesheetsReady(timeoutMs) {
        try {
            await this.page.evaluate(`typeof window.__speculumDomWaitStylesheetsReady === "function"
          ? window.__speculumDomWaitStylesheetsReady(${Math.max(0, timeoutMs | 0)})
          : null`);
        }
        catch {
            /* mid-navigation */
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
                try {
                    this.liveArmed = false;
                    // C4: wait styles before Dom document so the first client paint is not a
                    // long FOUC window ahead of Cssom install.
                    await this.waitStylesheetsReady(2500);
                    const mapped = (await this.page.evaluate(`typeof window.__speculumDomMapAndArmEstablish === "function"
              ? window.__speculumDomMapAndArmEstablish()
              : null`));
                    if (!mapped?.root)
                        return;
                    // Accept page MO immediately; emitFromPage enqueues behind this task.
                    this.liveArmed = true;
                    await this.materializeAndPush('dom', 'document', { root: mapped.root });
                    if (Array.isArray(mapped.sheets)) {
                        await this.materializeAndPush('cssom', 'install', { sheets: mapped.sheets });
                    }
                    armed = true;
                }
                catch {
                    this.liveArmed = false;
                }
                finally {
                    resolve(armed);
                }
            });
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
            if (operation === 'sheetList')
                this.noteCssomSheetList(payload);
        }
        if (this.stopped)
            return;
        this.push(plane, operation, payload);
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
        try {
            if ((0, DomAssetCache_1.isPassThroughUrl)(url)) {
                this.assets.registerPassThrough(key, url);
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
            if ((0, DomAssetCache_1.isPassThroughUrl)(url, ct)) {
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
    }
    async rewriteRemoteAssets(nodes) {
        const candidates = [];
        const seen = new Set();
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
            seen.add(raw);
            seen.add(url);
            candidates.push({ url, priority: assetFetchPriority(url, tag, attrs) });
        };
        const walk = (node) => {
            if (!node)
                return;
            if (node.attrs) {
                for (const key of ['href', 'src', 'poster', 'srcset', 'data-src', 'action', 'formaction']) {
                    const v = node.attrs[key];
                    if (!v)
                        continue;
                    if (key === 'srcset') {
                        for (const part of v.split(',')) {
                            const u = part.trim().split(/\s+/)[0];
                            consider(u, node.tag, node.attrs, key);
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
        const cssFetches = [];
        const otherFetches = [];
        for (const { url } of limited) {
            if (url.startsWith('data:') || url.startsWith('blob:'))
                continue;
            const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(url);
            if (!key)
                continue;
            // Stylesheets must land before Cssom install seeds from the cache (C6.5).
            if (/\.css(\?|$)/i.test(url) || assetFetchPriority(url, undefined, undefined) >= 90) {
                cssFetches.push(this.kickFetch(url, key));
            }
            else {
                otherFetches.push({ url, key });
            }
        }
        if (cssFetches.length)
            await Promise.all(cssFetches);
        for (const { url, key } of otherFetches) {
            void this.kickFetch(url, key);
        }
        if (urlToVirtual.size === 0)
            return;
        const rewriteNode = (node) => {
            if (!node?.attrs)
                return;
            for (const key of Object.keys(node.attrs)) {
                const v = node.attrs[key];
                if (!v)
                    continue;
                if (isDocumentNavigationAttr(key, node.tag, node.attrs))
                    continue;
                if (key === 'srcset') {
                    node.attrs[key] = v
                        .split(',')
                        .map((part) => {
                        const bits = part.trim().split(/\s+/);
                        const u = bits[0];
                        const mapped = rewriteLookup(u);
                        if (mapped)
                            bits[0] = mapped;
                        return bits.join(' ');
                    })
                        .join(', ');
                    continue;
                }
                const mapped = rewriteLookup(v);
                if (mapped)
                    node.attrs[key] = mapped;
                if (key === 'style') {
                    node.attrs[key] = v.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, q, raw) => {
                        const m = rewriteLookup(raw);
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
function parseDataUrl(url) {
    const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(url);
    if (!m)
        return null;
    const contentType = m[1] || 'application/octet-stream';
    const b64 = !!m[2];
    const data = m[3] ?? '';
    try {
        const body = b64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
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