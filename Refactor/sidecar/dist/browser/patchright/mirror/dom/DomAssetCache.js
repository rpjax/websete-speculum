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
 */
class DomAssetCache {
    maxBytes;
    maxEntries;
    byKey = new Map();
    byHash = new Map();
    order = [];
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
        };
        this.byKey.set(key, entry);
        this.byHash.set(hash, entry);
        this.order.push(key);
        while (this.order.length > this.maxEntries) {
            const old = this.order.shift();
            if (old)
                this.byKey.delete(old);
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
        this.order = [];
    }
    get size() {
        return this.byKey.size;
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