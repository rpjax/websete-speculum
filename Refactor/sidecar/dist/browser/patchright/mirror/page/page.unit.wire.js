"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPageProjectionWireUnitTests = runPageProjectionWireUnitTests;
const assert_1 = __importDefault(require("assert"));
const encode_1 = require("./encode");
const opcodes_1 = require("./opcodes");
const establish_1 = require("./establish");
const cssom_1 = require("./cssom");
const channel_1 = require("./channel");
const mirror_1 = require("./node/mirror");
const rewrite_1 = require("./node/rewrite");
const EventBridge_1 = require("../../../../host/EventBridge");
const assetPriority_1 = require("./assetPriority");
const cssomCdp_1 = require("./cssomCdp");
// Wire/encode/establish/cssom/channel/mirror unit coverage (split from page.unit for §9 LOC).
function readWireHeader(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    const magic = view.getUint16(o, true);
    o += 2;
    const version = view.getUint8(o);
    o += 1;
    const flags = view.getUint8(o);
    o += 1;
    const generation = view.getUint32(o, true);
    o += 4;
    const sequence = view.getUint32(o, true);
    o += 4;
    const partIndex = view.getUint16(o, true);
    o += 2;
    const partCount = view.getUint16(o, true);
    o += 2;
    const strCount = view.getUint32(o, true);
    o += 4;
    const strings = [];
    for (let i = 0; i < strCount; i++) {
        const len = view.getUint32(o, true);
        o += 4;
        strings.push(Buffer.from(bytes.subarray(o, o + len)).toString('utf8'));
        o += len;
    }
    const opCount = view.getUint32(o, true);
    o += 4;
    const firstOpCode = opCount > 0 ? view.getUint8(o) : -1;
    return { magic, version, flags, generation, sequence, partIndex, partCount, strings, opCount, firstOpCode };
}
function testEncodeFrameHeaderAndPatch() {
    const parts = (0, encode_1.encodeFrame)([{ op: 'patch', node: 7, snapshot: { kind: 'text', id: 7, value: 'hi' } }], { generation: 3, sequence: 9 });
    assert_1.default.strictEqual(parts.length, 1);
    const header = readWireHeader(parts[0]);
    assert_1.default.strictEqual(header.magic, 0x5050, "magic is 'PP'");
    assert_1.default.strictEqual(header.version, 1);
    assert_1.default.strictEqual(header.flags, 0);
    assert_1.default.strictEqual(header.generation, 3);
    assert_1.default.strictEqual(header.sequence, 9);
    assert_1.default.strictEqual(header.partIndex, 0);
    assert_1.default.strictEqual(header.partCount, 1);
    assert_1.default.strictEqual(header.opCount, 1);
    assert_1.default.strictEqual(header.firstOpCode, opcodes_1.OpCode.Patch);
    assert_1.default.ok(header.strings.includes('hi'), 'text value is interned in the string table');
    console.log('[unit] page/encode header + patch op ok');
}
function testEncodeFramePartSplitting() {
    const bigValue = 'x'.repeat(2000);
    const ops = Array.from({ length: 50 }, (_, i) => ({
        op: 'patch',
        node: i + 1,
        snapshot: { kind: 'text', id: i + 1, value: bigValue },
    }));
    const parts = (0, encode_1.encodeFrame)(ops, { generation: 1, sequence: 1 }, 4096);
    assert_1.default.ok(parts.length > 1, 'exceeding maxFrameBytes splits into multiple parts (PP-FR-8)');
    let totalOps = 0;
    parts.forEach((part, idx) => {
        const header = readWireHeader(part);
        assert_1.default.strictEqual(header.generation, 1);
        assert_1.default.strictEqual(header.sequence, 1, 'every part shares the same sequence — atomicity is never split');
        assert_1.default.strictEqual(header.partIndex, idx);
        assert_1.default.strictEqual(header.partCount, parts.length);
        assert_1.default.ok(part.byteLength <= 4096 + 4096, 'each part stays close to the byte budget');
        totalOps += header.opCount;
    });
    assert_1.default.strictEqual(totalOps, ops.length, 'no op is dropped across parts');
    const single = (0, encode_1.encodeFrame)([], { generation: 1, sequence: 1 }, encode_1.DEFAULT_MAX_FRAME_BYTES);
    assert_1.default.strictEqual(single.length, 1, 'an empty op list still yields exactly one (empty) part');
    console.log('[unit] page/encode part splitting ok');
}
function testEncodeFrameEstablishOpsSetEstablishFlag() {
    const ops = [
        { op: 'establishBegin', payload: (0, establish_1.buildEstablishBegin)(1, { width: 800, height: 600 }, { x: 0, y: 0 }) },
        { op: 'establishChunk', bytes: Buffer.from('<html></html>', 'utf8') },
        { op: 'establishEnd', nodeCount: 3, checksum: 42 },
    ];
    const parts = (0, encode_1.encodeFrame)(ops, { generation: 1, sequence: 0, establish: true });
    assert_1.default.strictEqual(parts.length, 1, 'a small establish frame stays in one part');
    const header = readWireHeader(parts[0]);
    assert_1.default.strictEqual(header.flags & 0b01, 0b01, 'establish flag (bit0) must be set on the header');
    assert_1.default.strictEqual(header.opCount, 3);
    assert_1.default.strictEqual(header.firstOpCode, opcodes_1.OpCode.EstablishBegin);
    console.log('[unit] page/encode establish ops set establish flag ok');
}
/** W0 — main-scope sheets must write hostId=0 so the client decoder stays aligned. */
function testEncodeCssomInstallMainAndPierceHostLayout() {
    const ops = [
        {
            op: 'cssomInstall',
            sheets: [
                { id: 1, scope: { kind: 'main' }, rules: [{ id: 10, cssText: 'body{margin:0}' }] },
                { id: 2, scope: { kind: 'pierceHost', hostId: 99 }, rules: [{ id: 11, cssText: '.x{color:red}' }] },
            ],
        },
    ];
    const parts = (0, encode_1.encodeFrame)(ops, { generation: 1, sequence: 1 });
    assert_1.default.strictEqual(parts.length, 1);
    const body = parts[0];
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    // Skip header (HEADER_BYTES) + string table — locate first op after string table.
    let o = 2 + 1 + 1 + 4 + 4 + 2 + 2; // magic..partCount
    const strCount = view.getUint32(o, true);
    o += 4;
    for (let i = 0; i < strCount; i++) {
        const len = view.getUint32(o, true);
        o += 4 + len;
    }
    const opCount = view.getUint32(o, true);
    o += 4;
    assert_1.default.strictEqual(opCount, 1);
    assert_1.default.strictEqual(view.getUint8(o), opcodes_1.OpCode.CssomInstall);
    o += 1;
    const sheetCount = view.getUint32(o, true);
    o += 4;
    assert_1.default.strictEqual(sheetCount, 2);
    // Sheet 1 (main): id, scopeByte=0, hostId=0, ruleCount
    assert_1.default.strictEqual(view.getUint32(o, true), 1);
    o += 4;
    assert_1.default.strictEqual(view.getUint8(o), 0);
    o += 1;
    assert_1.default.strictEqual(view.getUint32(o, true), 0, 'main scope always writes hostId=0');
    o += 4;
    const ruleCount1 = view.getUint32(o, true);
    o += 4;
    assert_1.default.strictEqual(ruleCount1, 1);
    o += 4; // rule id
    o += 4; // cssText string idx
    // Sheet 2 (pierceHost): id, scopeByte=1, hostId=99
    assert_1.default.strictEqual(view.getUint32(o, true), 2);
    o += 4;
    assert_1.default.strictEqual(view.getUint8(o), 1);
    o += 1;
    assert_1.default.strictEqual(view.getUint32(o, true), 99);
    console.log('[unit] page/encode cssomInstall main+pierceHost layout ok');
}
/** W2 — `runEstablish` must emit `cssomInstall` before `establishBegin` so the client's stylesheet set exists pre-parse (D-FLASH). */
function testEstablishFrameCssomInstallFirst() {
    const ops = [
        { op: 'cssomInstall', sheets: [] },
        { op: 'establishBegin', payload: (0, establish_1.buildEstablishBegin)(1, { width: 800, height: 600 }, { x: 0, y: 0 }) },
        { op: 'establishChunk', bytes: Buffer.from('<html></html>', 'utf8') },
        { op: 'establishEnd', nodeCount: 1, checksum: 1 },
    ];
    const parts = (0, encode_1.encodeFrame)(ops, { generation: 1, sequence: 0, establish: true });
    assert_1.default.strictEqual(parts.length, 1);
    const header = readWireHeader(parts[0]);
    assert_1.default.strictEqual(header.opCount, 4);
    assert_1.default.strictEqual(header.firstOpCode, opcodes_1.OpCode.CssomInstall, 'cssomInstall must ride first in the establish-shaped frame');
    console.log('[unit] page/encode establish frame cssomInstall-first ok');
}
/** §5.2.6 — `documentState` wire shape: interned title, then a presence byte + interned index per nullable field. */
function testEncodeDocumentStateOp() {
    const ops = [
        { op: 'documentState', title: 'Example', lang: 'en', dir: null, viewportContent: 'width=device-width' },
    ];
    const parts = (0, encode_1.encodeFrame)(ops, { generation: 1, sequence: 1 });
    assert_1.default.strictEqual(parts.length, 1);
    const body = parts[0];
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    let o = 2 + 1 + 1 + 4 + 4 + 2 + 2; // magic..partCount
    const strCount = view.getUint32(o, true);
    o += 4;
    const strings = [];
    for (let i = 0; i < strCount; i++) {
        const len = view.getUint32(o, true);
        o += 4;
        strings.push(Buffer.from(body.subarray(o, o + len)).toString('utf8'));
        o += len;
    }
    const opCount = view.getUint32(o, true);
    o += 4;
    assert_1.default.strictEqual(opCount, 1);
    assert_1.default.strictEqual(view.getUint8(o), opcodes_1.OpCode.DocumentState);
    o += 1;
    const titleIdx = view.getUint32(o, true);
    o += 4;
    assert_1.default.strictEqual(strings[titleIdx], 'Example');
    assert_1.default.strictEqual(view.getUint8(o), 1, 'lang is present');
    o += 1;
    const langIdx = view.getUint32(o, true);
    o += 4;
    assert_1.default.strictEqual(strings[langIdx], 'en');
    assert_1.default.strictEqual(view.getUint8(o), 0, 'dir is absent — presence byte 0, no string-table slot consumed');
    o += 1;
    assert_1.default.strictEqual(view.getUint8(o), 1, 'viewportContent is present');
    o += 1;
    const viewportIdx = view.getUint32(o, true);
    o += 4;
    assert_1.default.strictEqual(strings[viewportIdx], 'width=device-width');
    console.log('[unit] page/encode documentState op ok');
}
/** DocumentState (12) sorts numerically after the Cssom codes but must still ride the `dom` plane (Q19). */
function testOpCodePlaneDocumentStateRidesDom() {
    assert_1.default.strictEqual((0, opcodes_1.opCodePlane)(opcodes_1.OpCode.DocumentState), 'dom');
    assert_1.default.strictEqual((0, opcodes_1.opCodePlane)(opcodes_1.OpCode.CssomPatch), 'cssom');
    assert_1.default.strictEqual((0, opcodes_1.opCodePlane)(opcodes_1.OpCode.ChildList), 'dom');
    console.log('[unit] page/opcodes documentState rides dom plane ok');
}
/** Live cutover (Phase C1) — EventBridge/DropOldestQueue must relay an opaque §5.5 part unmodified. */
function testEventBridgeAcceptsBinaryShapedDiff() {
    const bridge = new EventBridge_1.EventBridge('s-page-projection-v2-unit');
    const parts = (0, encode_1.encodeFrame)([{ op: 'patch', node: 1, snapshot: { kind: 'text', id: 1, value: 'x' } }], { generation: 1, sequence: 1 });
    assert_1.default.strictEqual(parts.length, 1);
    bridge.onPageProjectionFrame({
        sequence: 1,
        generation: 1,
        plane: '',
        operation: '',
        timestampMs: Date.now(),
        body: parts[0],
        partIndex: 0,
        partCount: 1,
        flags: 0,
        version: 1,
    });
    assert_1.default.strictEqual(bridge.dom.pendingCount, 1, 'binary-shaped diff (empty plane/operation) must enqueue');
    bridge.close();
    console.log('[unit] page/encode + EventBridge binary diff acceptance ok');
}
// ------------------------------------------------------------ establish.ts
function testEstablishChecksumDeterministic() {
    const a = (0, establish_1.computeEstablishChecksum)(['html', 'body', 'div', 'span']);
    const b = (0, establish_1.computeEstablishChecksum)(['html', 'body', 'div', 'span']);
    const c = (0, establish_1.computeEstablishChecksum)(['html', 'body', 'span', 'div']);
    assert_1.default.deepStrictEqual(a, b, 'the same node stream always yields the same checksum');
    assert_1.default.notStrictEqual(a.checksum, c.checksum, 'a different node order yields a different checksum');
    assert_1.default.strictEqual(a.nodeCount, 4);
    const acc = new establish_1.EstablishChecksum();
    acc.addNode('html');
    assert_1.default.strictEqual(acc.nodeCount, 1);
    console.log('[unit] page/establish checksum ok');
}
function testEstablishHandoff() {
    const state = (0, establish_1.createEstablishHandoff)();
    assert_1.default.strictEqual(state.phase, 'idle');
    assert_1.default.strictEqual((0, establish_1.accumulateDuringEstablish)(state, 1), false, 'no epoch open yet — caller must not have frames to give');
    (0, establish_1.openEstablishEpoch)(state);
    assert_1.default.strictEqual(state.phase, 'accumulate');
    assert_1.default.strictEqual((0, establish_1.accumulateDuringEstablish)(state, 1), true);
    (0, establish_1.markSnapshotTaken)(state);
    assert_1.default.strictEqual(state.phase, 'snapshot');
    assert_1.default.strictEqual((0, establish_1.accumulateDuringEstablish)(state, 2), true, 'frames still accumulate after the snapshot (§5.6.6.b)');
    const drained = (0, establish_1.drainForEmitAfterEnd)(state);
    assert_1.default.deepStrictEqual(drained, [1, 2], 'accumulated frames drain in sequence order');
    assert_1.default.strictEqual(state.phase, 'idle');
    assert_1.default.deepStrictEqual(state.pendingFrames, []);
    const html = '<p>item</p>'.repeat(20); // tag-dense, so a `>` boundary is always reachable within budget.
    const chunks = (0, establish_1.splitHtmlIntoChunks)(html, 40);
    assert_1.default.ok(chunks.length > 1);
    assert_1.default.strictEqual(chunks.join(''), html, 'chunking never drops or reorders bytes');
    for (const chunk of chunks.slice(0, -1)) {
        assert_1.default.ok(chunk.endsWith('>'), 'every non-final chunk boundary lands after a closed tag');
    }
    // PP-EST-7: non-default chunk size must still reassemble identically (checksum page uses same budget).
    const chunksAlt = (0, establish_1.splitHtmlIntoChunks)(html, 17);
    assert_1.default.notStrictEqual(chunksAlt.length, chunks.length);
    assert_1.default.strictEqual(chunksAlt.join(''), html, 'chunkBytes≠default still covers full HTML');
    console.log('[unit] page/establish handoff + chunking ok');
}
// ------------------------------------------------------------ cssom.ts
function testCssomCoalesceAddRemoveCancels() {
    const coalescer = new cssom_1.CssomCoalescer();
    const sheet = { id: 1, scope: { kind: 'main' }, rules: [] };
    coalescer.addSheet(1, 0, sheet);
    coalescer.removeSheet(1);
    assert_1.default.strictEqual(coalescer.isEmpty, true, 'a sheet added and removed within the frame is never sent');
    assert_1.default.deepStrictEqual(coalescer.flush(), []);
    coalescer.addRule(1, 10, 0, { id: 10, cssText: 'a{}' });
    coalescer.removeRule(1, 10);
    assert_1.default.strictEqual(coalescer.isEmpty, true, 'a rule added and removed within the frame is never sent');
    console.log('[unit] page/cssom add+remove cancel ok');
}
function testCssomCoalescePatchCollapses() {
    const coalescer = new cssom_1.CssomCoalescer();
    coalescer.patchRule(10, 'a{color:red}');
    coalescer.patchRule(10, 'a{color:blue}');
    const ops = coalescer.flush();
    assert_1.default.strictEqual(ops.length, 1, 'repeated writes to one rule collapse to one cssomPatch');
    assert_1.default.deepStrictEqual(ops[0], { op: 'cssomPatch', rule: 10, cssText: 'a{color:blue}' });
    assert_1.default.strictEqual(coalescer.isEmpty, true, 'flush resets the coalescer');
    console.log('[unit] page/cssom patch collapse ok');
}
// ------------------------------------------------------------ channel.ts
function testChannelChunking() {
    const pushed = [];
    const channel = (0, channel_1.createBindingChannel)((bytes) => pushed.push(bytes));
    const payload = new Uint8Array(250).fill(7);
    const chunks = (0, channel_1.pushChunked)(channel, payload, 100);
    assert_1.default.strictEqual(chunks, 3);
    assert_1.default.strictEqual(pushed.length, 3);
    assert_1.default.strictEqual(pushed[0].byteLength, 100);
    assert_1.default.strictEqual(pushed[2].byteLength, 50);
    pushed.length = 0;
    (0, channel_1.pushFrameParts)(channel, [new Uint8Array([1]), new Uint8Array([2])]);
    assert_1.default.strictEqual(pushed.length, 2);
    console.log('[unit] page/channel chunking ok');
}
// ------------------------------------------------------------ node/mirror.ts
function testNodeMirrorApplyAndSerialize() {
    const mirror = new mirror_1.NodeMirror();
    const root = {
        kind: 'element',
        id: 1,
        tag: 'html',
        attrs: {},
        children: [
            {
                kind: 'element',
                id: 2,
                tag: 'body',
                attrs: { class: 'x' },
                children: [{ kind: 'text', id: 3, value: 'hello' }],
            },
        ],
    };
    mirror.seedRoot(root); // establish-equivalent bulk load — no live frame needed for the initial tree.
    assert_1.default.strictEqual(mirror.root, 1);
    assert_1.default.strictEqual(mirror.size >= 3, true);
    const html = mirror.serializeToHtml();
    assert_1.default.ok(html.includes('speculum-anchor="1"'));
    assert_1.default.ok(html.includes('speculum-anchor="2"'));
    assert_1.default.ok(html.includes('class="x"'));
    assert_1.default.ok(html.includes('hello'));
    const voidMirror = new mirror_1.NodeMirror();
    voidMirror.seedRoot({
        kind: 'element',
        id: 10,
        tag: 'div',
        attrs: {},
        children: [
            { kind: 'element', id: 11, tag: 'img', attrs: { src: 'x' }, children: [] },
            {
                kind: 'element',
                id: 12,
                tag: 'img',
                attrs: { src: 'y' },
                children: [{ kind: 'text', id: 13, value: 'oops' }],
            },
        ],
    });
    const voidHtml = voidMirror.serializeToHtml();
    assert_1.default.ok(/<img[^>]*src="x"[^>]*>/.test(voidHtml), 'empty void serializes');
    assert_1.default.ok(voidHtml.includes('oops'), 'void-with-children keeps interior (establish checksum)');
    mirror.applyFrame([{ op: 'patch', node: 3, snapshot: { kind: 'text', id: 3, value: 'updated' } }]);
    assert_1.default.strictEqual(mirror.get(3)?.value, 'updated');
    mirror.applyFrame([{ op: 'childList', parent: 1, mode: 'full', children: [] }]);
    assert_1.default.strictEqual(mirror.get(2), undefined, 'removing a parent unregisters its whole subtree');
    assert_1.default.strictEqual(mirror.get(3), undefined);
    console.log('[unit] page/node/mirror apply + serialize ok');
}
function testNodeMirrorDesyncOnMissingId() {
    const mirror = new mirror_1.NodeMirror();
    assert_1.default.throws(() => mirror.applyFrame([{ op: 'patch', node: 42, snapshot: { kind: 'text', id: 42, value: 'x' } }]), mirror_1.MirrorDesyncError);
    assert_1.default.throws(() => mirror.applyFrame([{ op: 'childList', parent: 42, mode: 'full', children: [] }]), mirror_1.MirrorDesyncError);
    console.log('[unit] page/node/mirror desync on missing id ok');
}
// ------------------------------------------------------------ node/rewrite.ts
function testUrlRewriterBasicsAndMemoIsolation() {
    const rewriter = new rewrite_1.UrlRewriter({ originHost: 'example.com' });
    assert_1.default.strictEqual(rewriter.rewriteUrl('/a.png'), '/w7s/virtual-assets/example.com/a.png');
    assert_1.default.strictEqual(rewriter.rewriteUrl('https://cdn.example.com/x.js?v=1'), '/w7s/virtual-assets/cdn.example.com/x.js?v=1');
    assert_1.default.strictEqual(rewriter.rewriteUrl('javascript:alert(1)'), 'javascript:alert(1)', 'never rewrites javascript: urls');
    assert_1.default.strictEqual(rewriter.rewriteUrl('data:text/plain,hi'), 'data:text/plain,hi');
    assert_1.default.strictEqual(rewriter.memoSize, 4, 'rewriteUrl memoizes per distinct raw url');
    const srcset = 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg 1920w, '
        + 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg 800w';
    const rewritten = rewriter.rewriteAttrValue('srcset', srcset);
    assert_1.default.ok(rewritten.includes('f_avif,q_auto,w_1920'), 'Cloudinary comma-bearing transforms survive rewriting');
    assert_1.default.ok(!rewritten.includes('https://'), 'srcset urls are rewritten to the virtual-assets prefix, not left absolute');
    assert_1.default.ok(rewritten.includes('/w7s/virtual-assets/res.cloudinary.com/'));
    const other = new rewrite_1.UrlRewriter({ originHost: 'example.com' });
    assert_1.default.strictEqual(other.memoSize, 0, 'no shared memo across instances (K2)');
    const css = rewriter.rewriteCssUrlFunctions('body{background:url("/bg.png")}');
    assert_1.default.ok(css.includes('/w7s/virtual-assets/example.com/bg.png'));
    console.log('[unit] page/node/rewrite basics + isolation ok');
}
// ------------------------------------------------------------ opcodes.ts
function testOpCodesAreStableAndUnique() {
    const values = Object.values(opcodes_1.OpCode).filter((v) => typeof v === 'number');
    assert_1.default.strictEqual(new Set(values).size, values.length, 'no opcode value collides');
    assert_1.default.strictEqual(opcodes_1.OpCode.EstablishBegin, 1, 'opcode numbering is wire-stable — never renumber');
    console.log('[unit] page/opcodes stable + unique ok');
}
function testSplitCssTopLevelRules() {
    const rules = (0, cssomCdp_1.splitCssTopLevelRules)('.a{color:red} @media (x){.b{color:blue}} .c{color:green}');
    assert_1.default.equal(rules.length, 3);
    assert_1.default.ok(rules[0].startsWith('.a{'));
    assert_1.default.ok(rules[1].startsWith('@media'));
    assert_1.default.ok(rules[2].startsWith('.c{'));
}
function testAssetPriorityQueueOrdersCssAndViewport() {
    const q = new assetPriority_1.AssetPriorityQueue(200);
    q.enqueue({ key: 'far', sourceUrl: 'https://x/far', distancePx: 2000, isCss: false });
    q.enqueue({ key: 'near', sourceUrl: 'https://x/near', distancePx: 10, isCss: false });
    q.enqueue({ key: 'css', sourceUrl: 'https://x/a.css', distancePx: 5000, isCss: true });
    assert_1.default.equal(q.takeNext()?.key, 'css');
    assert_1.default.equal(q.takeNext()?.key, 'near');
    assert_1.default.equal(q.takeNext()?.key, 'far');
}
function runPageProjectionWireUnitTests() {
    testEncodeFrameHeaderAndPatch();
    testEncodeFramePartSplitting();
    testEncodeFrameEstablishOpsSetEstablishFlag();
    testEncodeCssomInstallMainAndPierceHostLayout();
    testEstablishFrameCssomInstallFirst();
    testEncodeDocumentStateOp();
    testOpCodePlaneDocumentStateRidesDom();
    testEventBridgeAcceptsBinaryShapedDiff();
    testEstablishChecksumDeterministic();
    testEstablishHandoff();
    testCssomCoalesceAddRemoveCancels();
    testCssomCoalescePatchCollapses();
    testChannelChunking();
    testNodeMirrorApplyAndSerialize();
    testNodeMirrorDesyncOnMissingId();
    testUrlRewriterBasicsAndMemoIsolation();
    testOpCodesAreStableAndUnique();
    testSplitCssTopLevelRules();
    testAssetPriorityQueueOrdersCssAndViewport();
}
//# sourceMappingURL=page.unit.wire.js.map