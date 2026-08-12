"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCdpPierceUnit = runCdpPierceUnit;
/**
 * Unit coverage for F1 CDP pierce helpers (remap / XO attach / walk).
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const cdpPierce_1 = require("./cdpPierce");
function runCdpPierceUnit() {
    const pairs = [];
    (0, cdpPierce_1.walkCdpClosedShadows)({
        nodeId: 1,
        shadowRoots: [{ nodeId: 2, shadowRootType: 'closed', children: [] }],
        children: [{ nodeId: 3, shadowRoots: [{ nodeId: 4, shadowRootType: 'open' }] }],
    }, pairs);
    strict_1.default.equal(pairs.length, 1);
    strict_1.default.deepEqual(pairs[0], { hostId: 1, shadowId: 2 });
    const child = {
        kind: 'element',
        id: 10,
        tag: 'html',
        attrs: [],
        children: [{ kind: 'text', id: 11, value: 'xo' }],
    };
    const idMap = new Map();
    const remapped = (0, cdpPierce_1.remapPierceTree)(child, { value: 100 }, idMap);
    strict_1.default.equal(remapped.id, 100);
    strict_1.default.equal(idMap.get(10), 100);
    strict_1.default.equal(idMap.get(11), 101);
    strict_1.default.equal((0, cdpPierce_1.maxRawNodeId)(remapped), 101);
    const root = {
        kind: 'element',
        id: 1,
        tag: 'html',
        attrs: [],
        children: [
            {
                kind: 'element',
                id: 2,
                tag: 'iframe',
                attrs: [],
                children: [],
                xo: true,
            },
        ],
    };
    strict_1.default.deepEqual((0, cdpPierce_1.collectXoIframeIds)(root), [2]);
    strict_1.default.equal((0, cdpPierce_1.attachChildUnderIframe)(root, 2, remapped), true);
    const iframe = root.children[0];
    strict_1.default.ok(iframe && iframe.kind === 'element');
    strict_1.default.equal(iframe.children.length, 1);
    strict_1.default.equal((0, cdpPierce_1.collectXoIframeIds)(root).length, 0);
}
//# sourceMappingURL=cdpPierce.unit.js.map