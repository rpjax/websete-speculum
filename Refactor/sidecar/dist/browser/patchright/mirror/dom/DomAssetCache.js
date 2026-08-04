"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomAssetCache = void 0;
const node_crypto_1 = require("node:crypto");
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 256;
/**
 * Hash → bytes LRU for Dom Projection css/img/font (sidecar-side).
 */
class DomAssetCache {
    maxBytes;
    maxEntries;
    assets = new Map();
    order = [];
    constructor(maxBytes = DEFAULT_MAX_BYTES, maxEntries = DEFAULT_MAX_ENTRIES) {
        this.maxBytes = maxBytes;
        this.maxEntries = maxEntries;
    }
    get(hash) {
        return this.assets.get(hash);
    }
    put(body, contentType) {
        if (body.byteLength === 0 || body.byteLength > this.maxBytes)
            return null;
        const hash = (0, node_crypto_1.createHash)('sha256').update(body).digest('hex').slice(0, 32);
        if (!this.assets.has(hash)) {
            this.assets.set(hash, { body, contentType });
            this.order.push(hash);
            while (this.order.length > this.maxEntries) {
                const old = this.order.shift();
                if (old)
                    this.assets.delete(old);
            }
        }
        return hash;
    }
    clear() {
        this.assets.clear();
        this.order = [];
    }
    get size() {
        return this.assets.size;
    }
}
exports.DomAssetCache = DomAssetCache;
//# sourceMappingURL=DomAssetCache.js.map