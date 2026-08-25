"use strict";
/**
 * FrameRewriteHop — rewrite URL strings then rehash so Projected CHECK stays green.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testFrameRewriteHopRehashesCheck = testFrameRewriteHopRehashesCheck;
exports.testFrameRewriteHopBuffersMultiPart = testFrameRewriteHopBuffersMultiPart;
exports.testAssetStoreDataAndClear = testAssetStoreDataAndClear;
const strict_1 = __importDefault(require("node:assert/strict"));
const decode_1 = require("@speculum/page-projection/core/decode");
const elementNs_1 = require("@speculum/page-projection/core/elementNs");
const frame_1 = require("@speculum/page-projection/core/frame");
const opcodes_1 = require("@speculum/page-projection/core/opcodes");
const replicatedTable_1 = require("@speculum/page-projection/core/replicatedTable");
const replicatedTableApply_1 = require("@speculum/page-projection/core/replicatedTableApply");
const binaryFrameEncoder_1 = require("@speculum/page-projection/virtual/frame/binaryFrameEncoder");
const AssetStore_1 = require("./AssetStore");
const rewritePart_1 = require("./rewritePart");
const urlForms_1 = require("./urlForms");
function buildProducerFrame(ops, sequence = 1, resync = true) {
    const table = new replicatedTable_1.ReplicatedTable();
    if (resync)
        table.reset();
    table.setSequence(sequence);
    const preTableHash = table.tableHash;
    for (const op of ops) {
        if (op.op === opcodes_1.OpCode.Check)
            continue;
        (0, replicatedTableApply_1.applyOpToTable)(table, op);
    }
    const withCheck = [
        ...ops,
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: table.tableHash },
    ];
    const frame = (0, frame_1.createFrame)({
        generation: 1,
        sequence,
        preTableHash,
        resync,
        ops: withCheck,
    });
    return new binaryFrameEncoder_1.BinaryFrameEncoder().encode(frame)[0];
}
function testFrameRewriteHopRehashesCheck() {
    const assets = new AssetStore_1.AssetStore();
    const hop = new rewritePart_1.FrameRewriteHop();
    const ops = [
        {
            op: opcodes_1.OpCode.NodeNew,
            id: 10,
            kind: opcodes_1.NodeKind.Element,
            ns: elementNs_1.ElementNs.Html,
            name: 'img',
            attrs: [
                { name: 'src', value: 'https://cdn.example.com/hero.png' },
                { name: 'style', value: 'background:url(/bg.png)' },
            ],
        },
        {
            op: opcodes_1.OpCode.AttrSet,
            node: 10,
            attrs: [{ name: 'srcset', value: 'https://cdn.example.com/a.png 1x, https://cdn.example.com/b.png 2x' }],
        },
    ];
    const producerBytes = buildProducerFrame(ops);
    const outParts = hop.push(producerBytes, {
        pageUrl: 'https://www.example.com/app/',
        assets,
    });
    strict_1.default.equal(outParts.length, 1, 'single-part frame must emit one rewritten part');
    const decoded = (0, decode_1.decodeFramePart)(outParts[0], new decode_1.PersistentStringTable());
    strict_1.default.ok(decoded.ok);
    if (!decoded.ok)
        return;
    const img = decoded.part.ops.find((o) => o.op === opcodes_1.OpCode.NodeNew);
    strict_1.default.ok(img && img.op === opcodes_1.OpCode.NodeNew);
    if (img?.op === opcodes_1.OpCode.NodeNew && img.kind === opcodes_1.NodeKind.Element) {
        const src = img.attrs.find((a) => a.name === 'src')?.value ?? '';
        strict_1.default.equal(src, `${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/hero.png`);
        const style = img.attrs.find((a) => a.name === 'style')?.value ?? '';
        strict_1.default.ok(style.includes(urlForms_1.VIRTUAL_ASSETS_PREFIX), style);
    }
    const attr = decoded.part.ops.find((o) => o.op === opcodes_1.OpCode.AttrSet);
    strict_1.default.ok(attr && attr.op === opcodes_1.OpCode.AttrSet);
    if (attr?.op === opcodes_1.OpCode.AttrSet) {
        const srcset = attr.attrs.find((a) => a.name === 'srcset')?.value ?? '';
        strict_1.default.ok(srcset.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png`));
        strict_1.default.ok(srcset.includes('1x'));
    }
    const client = new replicatedTable_1.ReplicatedTable();
    const applied = (0, replicatedTableApply_1.applyFrameToTableChecked)(client, decoded.part.resync, decoded.part.ops, decoded.part.sequence);
    strict_1.default.equal(applied.ok, true, 'rewritten frame must CHECK-green on a fresh client table');
    const producerDecoded = (0, decode_1.decodeFramePart)(producerBytes, new decode_1.PersistentStringTable());
    strict_1.default.ok(producerDecoded.ok);
    if (producerDecoded.ok) {
        const checkP = producerDecoded.part.ops.find((o) => o.op === opcodes_1.OpCode.Check);
        const checkR = decoded.part.ops.find((o) => o.op === opcodes_1.OpCode.Check);
        strict_1.default.ok(checkP && checkR && checkP.op === opcodes_1.OpCode.Check && checkR.op === opcodes_1.OpCode.Check);
        if (checkP?.op === opcodes_1.OpCode.Check && checkR?.op === opcodes_1.OpCode.Check) {
            strict_1.default.notEqual(checkP.hash, checkR.hash, 'CHECK must change when URL strings change');
        }
    }
    console.log('[unit] FrameRewriteHop rehashes CHECK ok');
}
function testFrameRewriteHopBuffersMultiPart() {
    const assets = new AssetStore_1.AssetStore();
    const hop = new rewritePart_1.FrameRewriteHop();
    const encoder = new binaryFrameEncoder_1.BinaryFrameEncoder({ maxFrameBytes: 180 });
    const manyAttrs = Array.from({ length: 40 }, (_, i) => ({
        name: i % 2 === 0 ? 'data-src' : 'src',
        value: `https://cdn.example.com/p${i}.png?q=${i}`,
    }));
    const ops = [
        {
            op: opcodes_1.OpCode.NodeNew,
            id: 10,
            kind: opcodes_1.NodeKind.Element,
            ns: elementNs_1.ElementNs.Html,
            name: 'div',
            attrs: manyAttrs,
        },
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: 0n },
    ];
    const frame = (0, frame_1.createFrame)({
        generation: 1,
        sequence: 1,
        preTableHash: 0n,
        resync: true,
        ops,
    });
    const parts = encoder.encode(frame);
    strict_1.default.ok(parts.length >= 2, `expected multi-part encode, got ${parts.length}`);
    const emitted = [];
    for (const part of parts) {
        emitted.push(...hop.push(part, { pageUrl: 'https://www.example.com/', assets }));
    }
    strict_1.default.ok(emitted.length >= 1, 'hop must emit after the last part arrives');
    const persistent = new decode_1.PersistentStringTable();
    let sawVirtual = false;
    for (const bytes of emitted) {
        const d = (0, decode_1.decodeFramePart)(bytes, persistent);
        strict_1.default.ok(d.ok, 'rewritten multi-part must decode');
        if (!d.ok)
            continue;
        for (const op of d.part.ops) {
            if (op.op === opcodes_1.OpCode.NodeNew && op.kind === opcodes_1.NodeKind.Element) {
                for (const a of op.attrs) {
                    if (a.value.includes(urlForms_1.VIRTUAL_ASSETS_PREFIX))
                        sawVirtual = true;
                }
            }
        }
    }
    strict_1.default.ok(sawVirtual, 'multi-part rewrite must virtualize URL attrs');
    console.log('[unit] FrameRewriteHop multi-part buffer ok');
}
async function testAssetStoreDataAndClear() {
    const store = new AssetStore_1.AssetStore();
    store.materializeRewrite({
        kind: 'data',
        value: '/w7s/virtual-data/abc',
        id: 'abc123deadbeefcafe000001',
        body: Buffer.from('hello-data'),
        contentType: 'text/plain',
    });
    const hit = await store.getAsset('abc123deadbeefcafe000001', { kind: 'data' });
    strict_1.default.ok(hit);
    strict_1.default.equal(Buffer.from(hit.body).toString('utf8'), 'hello-data');
    strict_1.default.equal(hit.contentType, 'text/plain');
    store.clear();
    const miss = await store.getAsset('abc123deadbeefcafe000001', { kind: 'data' });
    strict_1.default.equal(miss, null);
    console.log('[unit] AssetStore data put/get/clear ok');
}
//# sourceMappingURL=rewritePart.unit.js.map