"use strict";
/**
 * Session L1 asset store — fill, pass-through, blob/data, getAsset (virtual-assets.md).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetStore = void 0;
const DomAssetCache_1 = require("../../../patchright/mirror/dom/DomAssetCache");
const urlForms_1 = require("./urlForms");
const FILL_TIMEOUT_MS = 10_000;
const PASS_THROUGH_TIMEOUT_MS = 30_000;
const AWAIT_FILL_MS = 8_000;
class AssetStore {
    cache = new DomAssetCache_1.DomAssetCache();
    inFlight = new Map();
    page = null;
    stopped = false;
    bindPage(page) {
        this.page = page;
    }
    clear() {
        this.stopped = true;
        this.cache.clear();
        this.inFlight.clear();
        this.stopped = false;
    }
    /** Side-effect from rewrite hop — kick materialize without blocking the frame. */
    materializeRewrite(result) {
        if (result.kind === 'unchanged' || result.kind === 'deny')
            return;
        if (result.kind === 'data') {
            this.cache.putData(result.id, result.body, result.contentType);
            return;
        }
        if (result.kind === 'blob') {
            void this.ingestBlob(result.sourceUrl, result.id);
            return;
        }
        // http
        if (result.passThrough) {
            this.cache.registerPassThrough(result.key, result.sourceUrl);
            // Still kick a warm fill for small media / manifests when useful.
        }
        void this.kickFill(result.sourceUrl, result.key);
    }
    async getAsset(key, opts) {
        if (!key)
            return null;
        let lookup = key;
        const kind = (opts?.kind ?? '').toLowerCase();
        if (kind === 'blob')
            lookup = key.startsWith('_blob/') ? key : `_blob/${key}`;
        else if (kind === 'data')
            lookup = key.startsWith('_data/') ? key : `_data/${key}`;
        const rangeHeader = opts?.rangeHeader;
        const hit = this.cache.get(lookup);
        if (hit && hit.body.byteLength > 0 && hit.mode === 'cache' && !rangeHeader) {
            return {
                body: hit.body,
                contentType: hit.contentType,
                statusCode: 200,
                ...shareabilityFields(hit.shareability),
            };
        }
        if (hit?.mode === 'pass-through' || rangeHeader || (hit && hit.body.byteLength === 0)) {
            const pt = await this.fetchPassThrough(lookup, rangeHeader);
            if (!pt) {
                return hit && hit.body.byteLength > 0
                    ? { body: hit.body, contentType: hit.contentType, statusCode: 200 }
                    : null;
            }
            return {
                body: pt.body,
                contentType: pt.contentType,
                statusCode: pt.statusCode,
                contentRange: pt.contentRange,
                passThrough: true,
            };
        }
        if (hit && hit.body.byteLength > 0) {
            return { body: hit.body, contentType: hit.contentType, statusCode: 200 };
        }
        // Warm miss: await in-flight fill, then recheck.
        const pending = this.inFlight.get(lookup);
        if (pending) {
            await Promise.race([pending, sleep(AWAIT_FILL_MS)]);
            const after = this.cache.get(lookup);
            if (after && after.body.byteLength > 0 && after.mode === 'cache') {
                return {
                    body: after.body,
                    contentType: after.contentType,
                    statusCode: 200,
                    ...shareabilityFields(after.shareability),
                };
            }
        }
        // Reconstruct https URL from key and try pass-through / fill.
        const pt = await this.fetchPassThrough(lookup, rangeHeader);
        if (!pt)
            return null;
        return {
            body: pt.body,
            contentType: pt.contentType,
            statusCode: pt.statusCode,
            contentRange: pt.contentRange,
            passThrough: true,
        };
    }
    async fetchPassThrough(key, rangeHeader) {
        const page = this.page;
        if (!page || this.stopped)
            return null;
        const e = this.cache.get(key);
        const sourceUrl = e?.sourceUrl ?? this.sourceUrlFromKey(key);
        try {
            const headers = {};
            if (rangeHeader)
                headers.Range = rangeHeader;
            const res = await page.context().request.get(sourceUrl, {
                timeout: PASS_THROUGH_TIMEOUT_MS,
                headers,
            });
            if (!res.ok() && res.status() !== 206)
                return null;
            let body = Buffer.from(await res.body());
            const headerCt = res.headers()['content-type'];
            let contentType = (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim() ||
                (0, urlForms_1.guessContentType)(sourceUrl) ||
                'application/octet-stream';
            if ((0, urlForms_1.isManifestUrl)(sourceUrl, contentType) && !rangeHeader) {
                body = Buffer.from((0, urlForms_1.rewriteManifestUrls)(body.toString('utf8'), sourceUrl), 'utf8');
                contentType = contentType.includes('dash')
                    ? 'application/dash+xml'
                    : 'application/vnd.apple.mpegurl';
                // Cache rewritten manifest for subsequent GETs (short; L1 FIFO).
                this.cache.put(key, body, contentType, { sourceUrl, mode: 'cache' });
                // Segment URLs inside need pass-through registration — kick from rewritten lines.
                this.registerManifestSegmentPassThroughs(body.toString('utf8'), sourceUrl);
            }
            const contentRange = res.headers()['content-range'];
            return {
                body,
                contentType,
                statusCode: res.status(),
                contentRange: typeof contentRange === 'string' ? contentRange : contentRange?.[0],
            };
        }
        catch {
            return null;
        }
    }
    kickFill(url, key) {
        const existing = this.inFlight.get(key);
        if (existing)
            return existing;
        const work = this.fillOnce(url, key).finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, work);
        return work;
    }
    async fillOnce(url, key) {
        const page = this.page;
        if (!page || this.stopped)
            return;
        try {
            if ((0, DomAssetCache_1.isPassThroughUrl)(url) && !(0, urlForms_1.isManifestUrl)(url)) {
                this.cache.registerPassThrough(key, url);
                return;
            }
            const res = await page.context().request.get(url, { timeout: FILL_TIMEOUT_MS });
            if (!res.ok())
                return;
            const bufRaw = Buffer.from(await res.body());
            const headerCt = res.headers()['content-type'];
            let ct = (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim() ||
                (0, urlForms_1.guessContentType)(url) ||
                'application/octet-stream';
            let buf = bufRaw;
            if (ct.includes('text/css')) {
                const css = (0, urlForms_1.absolutizeCssUrls)(bufRaw.toString('utf8'), url);
                const rewritten = (0, urlForms_1.rewriteCssUrlsToVirtual)(css);
                buf = Buffer.from(rewritten, 'utf8');
                this.kickNestedVirtualAssetRefs(rewritten, url);
            }
            else if ((0, urlForms_1.isManifestUrl)(url, ct)) {
                buf = Buffer.from((0, urlForms_1.rewriteManifestUrls)(bufRaw.toString('utf8'), url), 'utf8');
                ct = ct.includes('dash') ? 'application/dash+xml' : 'application/vnd.apple.mpegurl';
                this.registerManifestSegmentPassThroughs(buf.toString('utf8'), url);
            }
            const shareability = await this.captureShareability(page, url, res.headers());
            if ((0, DomAssetCache_1.isPassThroughUrl)(url, ct) && !(0, urlForms_1.isManifestUrl)(url, ct)) {
                this.cache.registerPassThrough(key, url, ct);
                this.cache.put(key, buf, ct, { sourceUrl: url, mode: 'pass-through', shareability });
            }
            else {
                this.cache.put(key, buf, ct, { sourceUrl: url, mode: 'cache', shareability });
            }
        }
        catch {
            /* optional warm fill */
        }
    }
    /**
     * CSS fill rewrites nested url()/@import to `/w7s/virtual-assets/…` in the cached body.
     * Kick L1 fill for those keys too — otherwise the Projected browser GETs them cold and the
     * scheme-less key fallback may miss (lab http fixtures).
     */
    kickNestedVirtualAssetRefs(css, baseUrl) {
        const re = /\/w7s\/virtual-assets\/([^\s'")]+)/gi;
        let m;
        while ((m = re.exec(css)) !== null) {
            const key = m[1];
            if (!key || key.includes('speculum-session-token'))
                continue;
            const sourceUrl = this.sourceUrlFromKey(key, baseUrl);
            if (!sourceUrl)
                continue;
            this.cache.registerPassThrough(key, sourceUrl);
            void this.kickFill(sourceUrl, key);
        }
    }
    /** Rebuild remote URL from L1 key; prefer scheme of `hintUrl` or the bound page. */
    sourceUrlFromKey(key, hintUrl) {
        if (key.includes('://'))
            return key;
        let protocol = 'https:';
        const hint = hintUrl || this.page?.url() || '';
        try {
            if (hint)
                protocol = new URL(hint).protocol || protocol;
        }
        catch {
            /* keep https */
        }
        if (protocol !== 'http:' && protocol !== 'https:')
            protocol = 'https:';
        return `${protocol}//${key}`;
    }
    registerManifestSegmentPassThroughs(manifest, baseUrl) {
        for (const line of manifest.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                const uri = /URI="([^"]+)"/i.exec(trimmed);
                if (uri?.[1]) {
                    try {
                        const abs = new URL(uri[1], baseUrl).href;
                        const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(abs);
                        if (key)
                            this.cache.registerPassThrough(key, abs);
                    }
                    catch {
                        /* */
                    }
                }
                continue;
            }
            if (trimmed.startsWith(urlForms_1.VIRTUAL_ASSETS_PREFIX)) {
                const key = trimmed.slice(urlForms_1.VIRTUAL_ASSETS_PREFIX.length);
                const abs = this.sourceUrlFromKey(key, baseUrl);
                this.cache.registerPassThrough(key, abs);
                continue;
            }
            try {
                const abs = new URL(trimmed, baseUrl).href;
                const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(abs);
                if (key)
                    this.cache.registerPassThrough(key, abs);
            }
            catch {
                /* */
            }
        }
    }
    async ingestBlob(blobUrl, id) {
        const page = this.page;
        if (!page || this.stopped)
            return;
        try {
            const hit = await page.evaluate(async (url) => {
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
            this.cache.putBlob(id, Buffer.from(hit.base64, 'base64'), hit.contentType);
        }
        catch {
            /* optional */
        }
    }
    async captureShareability(page, url, headers) {
        let requestHadCookie = false;
        try {
            const cookies = await page.context().cookies(url);
            requestHadCookie = cookies.length > 0;
        }
        catch {
            requestHadCookie = false;
        }
        const cacheControl = headerOne(headers, 'cache-control');
        const vary = headerOne(headers, 'vary');
        return { requestHadCookie, cacheControl, vary };
    }
}
exports.AssetStore = AssetStore;
function headerOne(headers, name) {
    const v = headers[name];
    if (typeof v === 'string')
        return v;
    if (Array.isArray(v))
        return v[0];
    return undefined;
}
function shareabilityFields(s) {
    if (!s)
        return {};
    return {
        requestHadCookie: s.requestHadCookie,
        requestHadAuthorization: s.requestHadAuthorization,
        cacheControl: s.cacheControl,
        vary: s.vary,
    };
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=AssetStore.js.map