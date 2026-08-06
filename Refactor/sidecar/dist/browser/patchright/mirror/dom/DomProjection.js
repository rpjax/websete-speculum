"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomProjection = void 0;
exports.attachDomAssetFetch = attachDomAssetFetch;
const node_crypto_1 = require("node:crypto");
const DomAssetCache_1 = require("./DomAssetCache");
const DomTreeSerializer_1 = require("./DomTreeSerializer");
const MAX_ASSET_FETCHES_PER_DIFF = 64;
const VIRTUAL_ASSETS_PREFIX = '/w7s/virtual-assets/';
const VIRTUAL_BLOB_PREFIX = '/w7s/virtual-blob/';
const VIRTUAL_DATA_PREFIX = '/w7s/virtual-data/';
/**
 * Dom Projection F producer: observe → anchor → coalesce → map → rewrite → emit.
 */
class DomProjection {
    page;
    events;
    sequence = 0;
    generation = 1;
    stopped = false;
    assets = new DomAssetCache_1.DomAssetCache();
    materializeChain = Promise.resolve();
    uploads = new Map();
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
        this.uploads.clear();
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
    async requestResync() {
        if (this.stopped)
            return;
        await this.emitSnapshot();
    }
    getGeneration() {
        return this.generation;
    }
    async onMainFrameNavigated() {
        try {
            const fromGeneration = this.generation;
            await this.page.evaluate(DomTreeSerializer_1.DOM_PROJECTION_PAGE_SCRIPT);
            const gen = await this.page.evaluate('window.__speculumDomBumpGeneration()');
            if (typeof gen === 'number')
                this.generation = gen;
            else
                this.generation += 1;
            this.events.onGenerationBumped?.({
                fromGeneration,
                toGeneration: this.generation,
                reason: 'main_frame_navigated',
                url: this.page.url(),
            });
            await this.emitSnapshot();
        }
        catch {
            /* mid-navigation */
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
            await this.materializeAndPush('dom', 'snapshot', body);
        }
        catch {
            /* ignore */
        }
    }
    emitFromPage(payload) {
        if (!payload || typeof payload !== 'object')
            return;
        const p = payload;
        if (typeof p.generation === 'number' && p.generation !== this.generation) {
            const fromGeneration = this.generation;
            this.generation = p.generation;
            this.events.onGenerationBumped?.({
                fromGeneration,
                toGeneration: p.generation,
                reason: 'page_emit_sync',
                diffKind: typeof p.kind === 'string' ? p.kind : undefined,
                url: this.page.url(),
            });
        }
        else if (typeof p.generation === 'number') {
            this.generation = p.generation;
        }
        if (p.kind === 'cssom' && Array.isArray(p.urls) && p.urls.length) {
            const body = { kind: 'cssom', urls: p.urls };
            this.materializeChain = this.materializeChain
                .then(() => this.materializeAndPush('cssom', 'cssom', body))
                .catch(() => { });
            return;
        }
        if (p.kind !== 'patch' || !Array.isArray(p.nodes) || p.nodes.length === 0)
            return;
        const body = { kind: 'patch', nodes: p.nodes };
        this.materializeChain = this.materializeChain
            .then(() => this.materializeAndPush('dom', 'patch', body))
            .catch(() => { });
    }
    async materializeAndPush(treeType, kind, body) {
        if (this.stopped)
            return;
        if (body.kind === 'cssom') {
            // Rewrite any absolute urls in the list to virtual-assets form for the client.
            body.urls = body.urls.map((u) => {
                if (u.startsWith('/w7s/'))
                    return u;
                if (u === '__inline__')
                    return u;
                const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(u);
                if (!key)
                    return u;
                void this.kickFetch(u, key);
                return VIRTUAL_ASSETS_PREFIX + key;
            });
            this.push(treeType, kind, body);
            return;
        }
        await this.rewriteRemoteAssets(body);
        if (this.stopped)
            return;
        this.push(treeType, kind, body);
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
    async rewriteRemoteAssets(body) {
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
        const consider = (raw, tag, attrs) => {
            if (!raw || seen.has(raw))
                return;
            if (raw.startsWith('/w7s/'))
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
                            consider(u, node.tag, node.attrs);
                        }
                    }
                    else {
                        consider(v, node.tag, node.attrs);
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
        if (body.kind === 'snapshot')
            walk(body.root);
        else
            for (const n of body.nodes)
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
        for (const { url } of limited) {
            if (url.startsWith('data:') || url.startsWith('blob:'))
                continue;
            const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(url);
            if (key)
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
        if (body.kind === 'snapshot')
            rewriteNode(body.root);
        else
            for (const n of body.nodes)
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
    push(treeType, kind, body) {
        this.sequence += 1;
        this.events.onDomDiff({
            sequence: this.sequence,
            generation: this.generation,
            treeType,
            kind,
            timestampMs: Date.now(),
            body: (0, DomTreeSerializer_1.encodeDomBody)(body),
        });
    }
}
exports.DomProjection = DomProjection;
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
    return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
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
/** Optional CDP Fetch hook — do not enable alongside Navigation Fetch.guard. */
async function attachDomAssetFetch(cdp, _put) {
    return async () => {
        void cdp;
    };
}
//# sourceMappingURL=DomProjection.js.map