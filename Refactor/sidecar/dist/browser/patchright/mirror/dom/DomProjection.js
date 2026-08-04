"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomProjection = void 0;
exports.attachDomAssetFetch = attachDomAssetFetch;
const DomAssetCache_1 = require("./DomAssetCache");
const DomTreeSerializer_1 = require("./DomTreeSerializer");
const MAX_ASSET_FETCHES_PER_DIFF = 48;
/**
 * Main-frame Dom Projection producer: page script + MutationObserver → Diff stream.
 * Not constructed when MirrorMode is VideoStreaming.
 */
class DomProjection {
    page;
    events;
    sequence = 0;
    generation = 1;
    stopped = false;
    assets = new DomAssetCache_1.DomAssetCache();
    materializeChain = Promise.resolve();
    constructor(page, events) {
        this.page = page;
        this.events = events;
    }
    static async start(page, events) {
        const proj = new DomProjection(page, events);
        await page.exposeBinding('__speculumDomEmit', (_source, payload) => {
            if (proj.stopped)
                return;
            proj.emitFromPage(payload);
        });
        await page.addInitScript({ content: DomTreeSerializer_1.DOM_PROJECTION_PAGE_SCRIPT });
        await page.evaluate(DomTreeSerializer_1.DOM_PROJECTION_PAGE_SCRIPT);
        await proj.emitSnapshot();
        page.on('framenavigated', (frame) => {
            if (frame !== page.mainFrame() || proj.stopped)
                return;
            void proj.onMainFrameNavigated();
        });
        return proj;
    }
    async stop() {
        this.stopped = true;
        this.assets.clear();
    }
    getAsset(hash) {
        return this.assets.get(hash);
    }
    putAsset(body, contentType) {
        return this.assets.put(body, contentType);
    }
    /** Force a keyframe snapshot (client sequence gap / explicit resync). */
    async requestResync() {
        if (this.stopped)
            return;
        await this.emitSnapshot();
    }
    async onMainFrameNavigated() {
        try {
            await this.page.evaluate(DomTreeSerializer_1.DOM_PROJECTION_PAGE_SCRIPT);
            const gen = await this.page.evaluate('window.__speculumDomBumpGeneration()');
            if (typeof gen === 'number')
                this.generation = gen;
            else
                this.generation += 1;
            await this.emitSnapshot();
        }
        catch {
            /* page may be mid-navigation */
        }
    }
    async emitSnapshot() {
        try {
            const snap = (await this.page.evaluate('window.__speculumDomSnapshot()'));
            if (!snap?.root)
                return;
            if (typeof snap.generation === 'number')
                this.generation = snap.generation;
            const body = { kind: 'snapshot', root: snap.root };
            await this.materializeAndPush('snapshot', body);
        }
        catch {
            /* ignore */
        }
    }
    emitFromPage(payload) {
        if (!payload || typeof payload !== 'object')
            return;
        const p = payload;
        if (p.kind !== 'patch' || !Array.isArray(p.ops) || p.ops.length === 0)
            return;
        if (typeof p.generation === 'number')
            this.generation = p.generation;
        const body = { kind: 'patch', ops: p.ops };
        // Serialize materialize work so snapshots/patches stay ordered.
        this.materializeChain = this.materializeChain
            .then(() => this.materializeAndPush('patch', body))
            .catch(() => { });
    }
    async materializeAndPush(kind, body) {
        if (this.stopped)
            return;
        await this.rewriteRemoteAssets(body);
        if (this.stopped)
            return;
        this.push(kind, body);
    }
    /**
     * Fetch remote href/src into the sidecar asset cache and rewrite attrs to
     * `speculum-asset:{hash}` so the client loads them via the API proxy.
     * Avoids CDP Fetch (owned by Navigation.setupFetchGuard).
     */
    async rewriteRemoteAssets(body) {
        const candidates = [];
        const seen = new Set();
        const consider = (url, tag, attrs) => {
            if (!url || !shouldProxyAssetUrl(url, tag, attrs) || seen.has(url))
                return;
            seen.add(url);
            candidates.push({
                url,
                priority: assetFetchPriority(url, tag, attrs),
            });
        };
        const walk = (node) => {
            if (!node)
                return;
            if (node.attrs) {
                consider(node.attrs['href'], node.tag, node.attrs);
                consider(node.attrs['src'], node.tag, node.attrs);
            }
            for (const child of node.children ?? [])
                walk(child);
        };
        if (body.kind === 'snapshot') {
            walk(body.root);
        }
        else {
            for (const op of body.ops) {
                if (op.node)
                    walk(op.node);
                if (op.op === 'setAttr'
                    && (op.name === 'href' || op.name === 'src')
                    && typeof op.value === 'string') {
                    consider(op.value, op.tag, op.name === 'href' ? { rel: 'stylesheet' } : undefined);
                }
            }
        }
        candidates.sort((a, b) => b.priority - a.priority);
        const limited = candidates.slice(0, MAX_ASSET_FETCHES_PER_DIFF);
        const urlToHash = new Map();
        await Promise.all(limited.map(async ({ url }) => {
            try {
                const res = await this.page.context().request.get(url, { timeout: 10_000 });
                if (!res.ok())
                    return;
                const bufRaw = Buffer.from(await res.body());
                const headerCt = res.headers()['content-type'];
                const ct = (typeof headerCt === 'string' ? headerCt : headerCt?.[0])
                    ?.split(';')[0]
                    ?.trim()
                    || guessContentType(url)
                    || 'application/octet-stream';
                const buf = ct === 'text/css' || ct.startsWith('text/css')
                    ? Buffer.from(absolutizeCssUrls(bufRaw.toString('utf8'), url), 'utf8')
                    : bufRaw;
                const hash = this.assets.put(buf, ct.split(';')[0].trim());
                if (hash)
                    urlToHash.set(url, hash);
            }
            catch {
                /* remote asset optional */
            }
        }));
        if (urlToHash.size === 0)
            return;
        const rewriteNode = (node) => {
            if (!node)
                return;
            if (node.attrs) {
                for (const key of ['href', 'src']) {
                    const v = node.attrs[key];
                    if (v && urlToHash.has(v)) {
                        node.attrs[key] = `speculum-asset:${urlToHash.get(v)}`;
                    }
                }
            }
            for (const child of node.children ?? [])
                rewriteNode(child);
        };
        if (body.kind === 'snapshot') {
            rewriteNode(body.root);
            body.assetHints = [...urlToHash.values()].map((hash) => {
                const entry = this.assets.get(hash);
                return { hash, contentType: entry.contentType };
            });
        }
        else {
            for (const op of body.ops) {
                if (op.node)
                    rewriteNode(op.node);
                if (op.op === 'setAttr'
                    && (op.name === 'href' || op.name === 'src')
                    && typeof op.value === 'string'
                    && urlToHash.has(op.value)) {
                    op.value = `speculum-asset:${urlToHash.get(op.value)}`;
                }
            }
        }
    }
    push(kind, body) {
        this.sequence += 1;
        this.events.onDomDiff({
            sequence: this.sequence,
            generation: this.generation,
            kind,
            timestampMs: Date.now(),
            body: (0, DomTreeSerializer_1.encodeDomBody)(body),
        });
    }
}
exports.DomProjection = DomProjection;
function shouldProxyAssetUrl(url, tag, attrs) {
    if (!/^https?:\/\//i.test(url))
        return false;
    try {
        const parsed = new URL(url);
        // Bare origins (preconnect / dns-prefetch) are not assets.
        if (!parsed.pathname || parsed.pathname === '/')
            return false;
    }
    catch {
        return false;
    }
    const rel = (attrs?.rel ?? '').toLowerCase();
    if (tag === 'link') {
        return rel.includes('stylesheet') || /\.css(\?|$)/i.test(url);
    }
    if (tag === 'img' || tag === 'source' || tag === 'image')
        return true;
    return /\.(css|png|jpe?g|gif|webp|svg|woff2?|ttf|otf)(\?|$)/i.test(url);
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
    return 10;
}
/** Make relative CSS url() absolute against the stylesheet URL (CDN fonts/images keep working). */
function absolutizeCssUrls(css, baseUrl) {
    return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
        const trimmed = raw.trim();
        if (!trimmed
            || trimmed.startsWith('data:')
            || trimmed.startsWith('http://')
            || trimmed.startsWith('https://')
            || trimmed.startsWith('speculum-asset:')) {
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
    return null;
}
/** Optional CDP Fetch hook for asset caching — do not enable alongside Navigation Fetch.guard. */
async function attachDomAssetFetch(cdp, put) {
    await cdp.send('Fetch.enable', {
        patterns: [
            { requestStage: 'Response', resourceType: 'Stylesheet' },
            { requestStage: 'Response', resourceType: 'Image' },
            { requestStage: 'Response', resourceType: 'Font' },
        ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onPaused = async (event) => {
        const requestId = event.requestId;
        try {
            const { body, base64Encoded } = await cdp.send('Fetch.getResponseBody', { requestId });
            const buf = Buffer.from(body, base64Encoded ? 'base64' : 'utf8');
            const headers = event.responseHeaders ?? [];
            const ct = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value
                ?? 'application/octet-stream';
            put(buf, ct.split(';')[0].trim());
        }
        catch {
            /* */
        }
        try {
            await cdp.send('Fetch.continueResponse', { requestId });
        }
        catch {
            /* */
        }
    };
    cdp.on('Fetch.requestPaused', onPaused);
    return async () => {
        cdp.off('Fetch.requestPaused', onPaused);
        try {
            await cdp.send('Fetch.disable');
        }
        catch {
            /* */
        }
    };
}
//# sourceMappingURL=DomProjection.js.map