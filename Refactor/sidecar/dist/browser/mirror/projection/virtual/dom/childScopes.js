"use strict";
/**
 * Per-instance child-scope indexer. Not hashed into CHECK. Drop with the host row.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChildScopeIndex = void 0;
exports.createMintPort = createMintPort;
const nestedHost_1 = require("./nestedHost");
class ChildScopeIndex {
    mint;
    map = new Map();
    constructor(mint) {
        this.mint = mint;
    }
    get mapView() {
        return this.map;
    }
    get(nodeId) {
        return this.map.get(nodeId);
    }
    drop(nodeId) {
        this.map.delete(nodeId);
    }
    admit(nodeId, node) {
        if (!(0, nestedHost_1.isNestedBrowsingHost)(node))
            return { kind: 'none' };
        const existing = this.map.get(nodeId);
        if (existing !== undefined)
            return { kind: 'host', contextId: existing };
        const minted = this.mint();
        if (minted == null)
            return { kind: 'pending' };
        this.map.set(nodeId, minted);
        return { kind: 'host', contextId: minted };
    }
    lookupByContentWindow(source, nodeOf) {
        for (const [nodeId, contextId] of this.map) {
            const node = nodeOf(nodeId);
            if (node && node.contentWindow === source) {
                return contextId;
            }
        }
        return undefined;
    }
}
exports.ChildScopeIndex = ChildScopeIndex;
function createMintPort(opts) {
    if (opts.mintSync)
        return () => opts.mintSync();
    const cache = [];
    let inflight = false;
    const kick = () => {
        if (inflight || !opts.requestMint)
            return;
        inflight = true;
        void opts.requestMint().then((c) => {
            inflight = false;
            if (typeof c === 'number' && c >= 2)
                cache.push(c);
        });
    };
    return () => {
        if (cache.length > 0)
            return cache.shift();
        kick();
        return null;
    };
}
//# sourceMappingURL=childScopes.js.map