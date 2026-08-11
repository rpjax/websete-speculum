"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomAssetCache = void 0;
exports.virtualAssetKeyFromUrl = virtualAssetKeyFromUrl;
exports.isPassThroughUrl = isPassThroughUrl;
const node_crypto_1 = require("node:crypto");
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 512;
/**
 * Session asset store for Dom Projection (path-keyed + optional hash lookup).
 *
 * Evicts on two independent caps, either one triggers eviction (§5.16
 * `assetCacheL1MaxBytes`, PP-ASSET-4): a max entry count and a max total byte
 * budget summed across every stored body. Eviction order is insertion order
 * (FIFO) — a `get()` does not bump recency, matching the entry-count
 * eviction this cache always had.
 */
class DomAssetCache {
    maxBytes;
    maxEntries;
    byKey = new Map();
    byHash = new Map();
    keyToHash = new Map();
    order = [];
    totalBytes = 0;
    constructor(maxBytes = DEFAULT_MAX_BYTES, maxEntries = DEFAULT_MAX_ENTRIES) {
        this.maxBytes = maxBytes;
        this.maxEntries = maxEntries;
    }
    get(key) {
        return this.byKey.get(key) ?? this.byHash.get(key);
    }
    getByHash(hash) {
        return this.byHash.get(hash);
    }
    put(key, body, contentType, opts) {
        if (body.byteLength === 0 || body.byteLength > this.maxBytes)
            return null;
        const hash = (0, node_crypto_1.createHash)('sha256').update(body).digest('hex').slice(0, 32);
        const entry = {
            body,
            contentType,
            sourceUrl: opts?.sourceUrl,
            mode: opts?.mode ?? 'cache',
            shareability: opts?.shareability,
        };
        // Re-putting the same key replaces its bytes and refreshes its FIFO slot —
        // drop the stale `order` reference first so eviction never double-counts it.
        if (this.byKey.has(key)) {
            const staleIndex = this.order.indexOf(key);
            if (staleIndex !== -1)
                this.order.splice(staleIndex, 1);
        }
        this.evictKey(key);
        this.byKey.set(key, entry);
        this.byHash.set(hash, entry);
        this.keyToHash.set(key, hash);
        this.order.push(key);
        this.totalBytes += body.byteLength;
        while (this.order.length > 0 && (this.order.length > this.maxEntries || this.totalBytes > this.maxBytes)) {
            const old = this.order.shift();
            if (old !== undefined)
                this.evictKey(old);
        }
        return hash;
    }
    putBlob(id, body, contentType) {
        this.put(`_blob/${id}`, body, contentType, { mode: 'cache' });
    }
    putData(id, body, contentType) {
        this.put(`_data/${id}`, body, contentType, { mode: 'cache' });
    }
    registerPassThrough(key, sourceUrl, contentType = 'application/octet-stream') {
        const existing = this.byKey.get(key);
        if (existing && existing.body.byteLength > 0)
            return;
        this.byKey.set(key, {
            body: Buffer.alloc(0),
            contentType,
            sourceUrl,
            mode: 'pass-through',
        });
    }
    clear() {
        this.byKey.clear();
        this.byHash.clear();
        this.keyToHash.clear();
        this.order = [];
        this.totalBytes = 0;
    }
    get size() {
        return this.byKey.size;
    }
    /** Sum of stored body bytes (PP-ASSET-4) — pass-through entries carry no bytes. */
    get currentBytes() {
        return this.totalBytes;
    }
    evictKey(key) {
        const existing = this.byKey.get(key);
        if (!existing)
            return;
        this.totalBytes -= existing.body.byteLength;
        this.byKey.delete(key);
        const hash = this.keyToHash.get(key);
        if (hash !== undefined) {
            this.byHash.delete(hash);
            this.keyToHash.delete(key);
        }
    }
}
exports.DomAssetCache = DomAssetCache;
function virtualAssetKeyFromUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return null;
        return `${u.host}${u.pathname}${u.search}`;
    }
    catch {
        return null;
    }
}
function isPassThroughUrl(url, contentType) {
    const ct = (contentType ?? '').toLowerCase();
    if (ct.startsWith('video/') || ct.startsWith('audio/'))
        return true;
    const path = url.split('?')[0].toLowerCase();
    return /\.(mp4|webm|m4v|mov|mp3|wav|ogg|m3u8|mpd|ts)(\?|$)/i.test(path);
}
//# sourceMappingURL=DomAssetCache.js.map