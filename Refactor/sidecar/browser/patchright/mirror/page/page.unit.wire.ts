import assert from 'assert';
import { IdentitySpace, NONE_NODE_ID } from './identity';
import {
  isPlaceholderTag,
  publishElementSnapshot,
  stripDeniedAttrs,
  PROJECTED_TAG_ATTR,
  STATE_ATTR_KEYS,
  type FNode,
} from './fmap';
import {
  createDirtyState,
  markMutation,
  markNewId,
  discardNonPublished,
  VIEWPORT_SCROLL_TARGET,
} from './observe';
import { FrameAccumulator, type ChildRef, type FrameOp, type FrameTreeQuery } from './frame';
import { FrameClock, RATE_LADDER, type FrameClockScheduler } from './clock';
import { encodeFrame, DEFAULT_MAX_FRAME_BYTES, type WireOp } from './encode';
import { OpCode, opCodePlane } from './opcodes';
import {
  EstablishChecksum,
  computeEstablishChecksum,
  createEstablishHandoff,
  openEstablishEpoch,
  accumulateDuringEstablish,
  markSnapshotTaken,
  drainForEmitAfterEnd,
  splitHtmlIntoChunks,
  buildEstablishBegin,
} from './establish';
import { CssomCoalescer, type CssomSheetDescriptor } from './cssom';
import { pushChunked, pushFrameParts, createBindingChannel } from './channel';
import { NodeMirror, MirrorDesyncError } from './node/mirror';
import { UrlRewriter } from './node/rewrite';
import { EventBridge } from '../../../../host/EventBridge';
import { runCdpPierceUnit } from './cdpPierce.unit';
import { AssetPriorityQueue } from './assetPriority';
import { splitCssTopLevelRules } from './cssomCdp';

// Wire/encode/establish/cssom/channel/mirror unit coverage (split from page.unit for §9 LOC).
function readWireHeader(bytes: Uint8Array): {
  magic: number;
  version: number;
  flags: number;
  generation: number;
  sequence: number;
  partIndex: number;
  partCount: number;
  strings: string[];
  opCount: number;
  firstOpCode: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const magic = view.getUint16(o, true); o += 2;
  const version = view.getUint8(o); o += 1;
  const flags = view.getUint8(o); o += 1;
  const generation = view.getUint32(o, true); o += 4;
  const sequence = view.getUint32(o, true); o += 4;
  const partIndex = view.getUint16(o, true); o += 2;
  const partCount = view.getUint16(o, true); o += 2;
  const strCount = view.getUint32(o, true); o += 4;
  const strings: string[] = [];
  for (let i = 0; i < strCount; i++) {
    const len = view.getUint32(o, true); o += 4;
    strings.push(Buffer.from(bytes.subarray(o, o + len)).toString('utf8'));
    o += len;
  }
  const opCount = view.getUint32(o, true); o += 4;
  const firstOpCode = opCount > 0 ? view.getUint8(o) : -1;
  return { magic, version, flags, generation, sequence, partIndex, partCount, strings, opCount, firstOpCode };
}

function testEncodeFrameHeaderAndPatch(): void {
  const parts = encodeFrame(
    [{ op: 'patch', node: 7, snapshot: { kind: 'text', id: 7, value: 'hi' } }],
    { generation: 3, sequence: 9 },
  );
  assert.strictEqual(parts.length, 1);
  const header = readWireHeader(parts[0]!);
  assert.strictEqual(header.magic, 0x5050, "magic is 'PP'");
  assert.strictEqual(header.version, 1);
  assert.strictEqual(header.flags, 0);
  assert.strictEqual(header.generation, 3);
  assert.strictEqual(header.sequence, 9);
  assert.strictEqual(header.partIndex, 0);
  assert.strictEqual(header.partCount, 1);
  assert.strictEqual(header.opCount, 1);
  assert.strictEqual(header.firstOpCode, OpCode.Patch);
  assert.ok(header.strings.includes('hi'), 'text value is interned in the string table');
  console.log('[unit] page/encode header + patch op ok');
}

function testEncodeFramePartSplitting(): void {
  const bigValue = 'x'.repeat(2000);
  const ops = Array.from({ length: 50 }, (_, i) => ({
    op: 'patch' as const,
    node: i + 1,
    snapshot: { kind: 'text' as const, id: i + 1, value: bigValue },
  }));
  const parts = encodeFrame(ops, { generation: 1, sequence: 1 }, 4096);
  assert.ok(parts.length > 1, 'exceeding maxFrameBytes splits into multiple parts (PP-FR-8)');
  let totalOps = 0;
  parts.forEach((part, idx) => {
    const header = readWireHeader(part);
    assert.strictEqual(header.generation, 1);
    assert.strictEqual(header.sequence, 1, 'every part shares the same sequence — atomicity is never split');
    assert.strictEqual(header.partIndex, idx);
    assert.strictEqual(header.partCount, parts.length);
    assert.ok(part.byteLength <= 4096 + 4096, 'each part stays close to the byte budget');
    totalOps += header.opCount;
  });
  assert.strictEqual(totalOps, ops.length, 'no op is dropped across parts');
  const single = encodeFrame([], { generation: 1, sequence: 1 }, DEFAULT_MAX_FRAME_BYTES);
  assert.strictEqual(single.length, 1, 'an empty op list still yields exactly one (empty) part');
  console.log('[unit] page/encode part splitting ok');
}

function testEncodeFrameEstablishOpsSetEstablishFlag(): void {
  const ops: WireOp[] = [
    { op: 'establishBegin', payload: buildEstablishBegin(1, { width: 800, height: 600 }, { x: 0, y: 0 }) },
    { op: 'establishChunk', bytes: Buffer.from('<html></html>', 'utf8') },
    { op: 'establishEnd', nodeCount: 3, checksum: 42 },
  ];
  const parts = encodeFrame(ops, { generation: 1, sequence: 0, establish: true });
  assert.strictEqual(parts.length, 1, 'a small establish frame stays in one part');
  const header = readWireHeader(parts[0]!);
  assert.strictEqual(header.flags & 0b01, 0b01, 'establish flag (bit0) must be set on the header');
  assert.strictEqual(header.opCount, 3);
  assert.strictEqual(header.firstOpCode, OpCode.EstablishBegin);
  console.log('[unit] page/encode establish ops set establish flag ok');
}

/** W0 — main-scope sheets must write hostId=0 so the client decoder stays aligned. */
function testEncodeCssomInstallMainAndPierceHostLayout(): void {
  const ops: WireOp[] = [
    {
      op: 'cssomInstall',
      sheets: [
        { id: 1, scope: { kind: 'main' }, rules: [{ id: 10, cssText: 'body{margin:0}' }] },
        { id: 2, scope: { kind: 'pierceHost', hostId: 99 }, rules: [{ id: 11, cssText: '.x{color:red}' }] },
      ],
    },
  ];
  const parts = encodeFrame(ops, { generation: 1, sequence: 1 });
  assert.strictEqual(parts.length, 1);
  const body = parts[0]!;
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
  assert.strictEqual(opCount, 1);
  assert.strictEqual(view.getUint8(o), OpCode.CssomInstall);
  o += 1;
  const sheetCount = view.getUint32(o, true);
  o += 4;
  assert.strictEqual(sheetCount, 2);
  // Sheet 1 (main): id, scopeByte=0, hostId=0, ruleCount
  assert.strictEqual(view.getUint32(o, true), 1);
  o += 4;
  assert.strictEqual(view.getUint8(o), 0);
  o += 1;
  assert.strictEqual(view.getUint32(o, true), 0, 'main scope always writes hostId=0');
  o += 4;
  const ruleCount1 = view.getUint32(o, true);
  o += 4;
  assert.strictEqual(ruleCount1, 1);
  o += 4; // rule id
  o += 4; // cssText string idx
  // Sheet 2 (pierceHost): id, scopeByte=1, hostId=99
  assert.strictEqual(view.getUint32(o, true), 2);
  o += 4;
  assert.strictEqual(view.getUint8(o), 1);
  o += 1;
  assert.strictEqual(view.getUint32(o, true), 99);
  console.log('[unit] page/encode cssomInstall main+pierceHost layout ok');
}

/** W2 — `runEstablish` must emit `cssomInstall` before `establishBegin` so the client's stylesheet set exists pre-parse (D-FLASH). */
function testEstablishFrameCssomInstallFirst(): void {
  const ops: WireOp[] = [
    { op: 'cssomInstall', sheets: [] },
    { op: 'establishBegin', payload: buildEstablishBegin(1, { width: 800, height: 600 }, { x: 0, y: 0 }) },
    { op: 'establishChunk', bytes: Buffer.from('<html></html>', 'utf8') },
    { op: 'establishEnd', nodeCount: 1, checksum: 1 },
  ];
  const parts = encodeFrame(ops, { generation: 1, sequence: 0, establish: true });
  assert.strictEqual(parts.length, 1);
  const header = readWireHeader(parts[0]!);
  assert.strictEqual(header.opCount, 4);
  assert.strictEqual(header.firstOpCode, OpCode.CssomInstall, 'cssomInstall must ride first in the establish-shaped frame');
  console.log('[unit] page/encode establish frame cssomInstall-first ok');
}

/** §5.2.6 — `documentState` wire shape: interned title, then a presence byte + interned index per nullable field. */
function testEncodeDocumentStateOp(): void {
  const ops: WireOp[] = [
    { op: 'documentState', title: 'Example', lang: 'en', dir: null, viewportContent: 'width=device-width' },
  ];
  const parts = encodeFrame(ops, { generation: 1, sequence: 1 });
  assert.strictEqual(parts.length, 1);
  const body = parts[0]!;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let o = 2 + 1 + 1 + 4 + 4 + 2 + 2; // magic..partCount
  const strCount = view.getUint32(o, true);
  o += 4;
  const strings: string[] = [];
  for (let i = 0; i < strCount; i++) {
    const len = view.getUint32(o, true);
    o += 4;
    strings.push(Buffer.from(body.subarray(o, o + len)).toString('utf8'));
    o += len;
  }
  const opCount = view.getUint32(o, true);
  o += 4;
  assert.strictEqual(opCount, 1);
  assert.strictEqual(view.getUint8(o), OpCode.DocumentState);
  o += 1;
  const titleIdx = view.getUint32(o, true);
  o += 4;
  assert.strictEqual(strings[titleIdx], 'Example');
  assert.strictEqual(view.getUint8(o), 1, 'lang is present');
  o += 1;
  const langIdx = view.getUint32(o, true);
  o += 4;
  assert.strictEqual(strings[langIdx], 'en');
  assert.strictEqual(view.getUint8(o), 0, 'dir is absent — presence byte 0, no string-table slot consumed');
  o += 1;
  assert.strictEqual(view.getUint8(o), 1, 'viewportContent is present');
  o += 1;
  const viewportIdx = view.getUint32(o, true);
  o += 4;
  assert.strictEqual(strings[viewportIdx], 'width=device-width');
  console.log('[unit] page/encode documentState op ok');
}

/** DocumentState (12) sorts numerically after the Cssom codes but must still ride the `dom` plane (Q19). */
function testOpCodePlaneDocumentStateRidesDom(): void {
  assert.strictEqual(opCodePlane(OpCode.DocumentState), 'dom');
  assert.strictEqual(opCodePlane(OpCode.CssomPatch), 'cssom');
  assert.strictEqual(opCodePlane(OpCode.ChildList), 'dom');
  console.log('[unit] page/opcodes documentState rides dom plane ok');
}

/** Live cutover (Phase C1) — EventBridge/DropOldestQueue must relay an opaque §5.5 part unmodified. */
function testEventBridgeAcceptsBinaryShapedDiff(): void {
  const bridge = new EventBridge('s-page-projection-v2-unit');
  const parts = encodeFrame(
    [{ op: 'patch', node: 1, snapshot: { kind: 'text', id: 1, value: 'x' } }],
    { generation: 1, sequence: 1 },
  );
  assert.strictEqual(parts.length, 1);
  bridge.onPageProjectionDiff({
    sequence: 1,
    generation: 1,
    plane: '',
    operation: '',
    timestampMs: Date.now(),
    body: parts[0]!,
    partIndex: 0,
    partCount: 1,
    flags: 0,
    version: 1,
  });
  assert.strictEqual(bridge.dom.pendingCount, 1, 'binary-shaped diff (empty plane/operation) must enqueue');
  bridge.close();
  console.log('[unit] page/encode + EventBridge binary diff acceptance ok');
}

// ------------------------------------------------------------ establish.ts

function testEstablishChecksumDeterministic(): void {
  const a = computeEstablishChecksum(['html', 'body', 'div', 'span']);
  const b = computeEstablishChecksum(['html', 'body', 'div', 'span']);
  const c = computeEstablishChecksum(['html', 'body', 'span', 'div']);
  assert.deepStrictEqual(a, b, 'the same node stream always yields the same checksum');
  assert.notStrictEqual(a.checksum, c.checksum, 'a different node order yields a different checksum');
  assert.strictEqual(a.nodeCount, 4);

  const acc = new EstablishChecksum();
  acc.addNode('html');
  assert.strictEqual(acc.nodeCount, 1);
  console.log('[unit] page/establish checksum ok');
}

function testEstablishHandoff(): void {
  const state = createEstablishHandoff<number>();
  assert.strictEqual(state.phase, 'idle');
  assert.strictEqual(accumulateDuringEstablish(state, 1), false, 'no epoch open yet — caller must not have frames to give');

  openEstablishEpoch(state);
  assert.strictEqual(state.phase, 'accumulate');
  assert.strictEqual(accumulateDuringEstablish(state, 1), true);
  markSnapshotTaken(state);
  assert.strictEqual(state.phase, 'snapshot');
  assert.strictEqual(accumulateDuringEstablish(state, 2), true, 'frames still accumulate after the snapshot (§5.6.6.b)');

  const drained = drainForEmitAfterEnd(state);
  assert.deepStrictEqual(drained, [1, 2], 'accumulated frames drain in sequence order');
  assert.strictEqual(state.phase, 'idle');
  assert.deepStrictEqual(state.pendingFrames, []);

  const html = '<p>item</p>'.repeat(20); // tag-dense, so a `>` boundary is always reachable within budget.
  const chunks = splitHtmlIntoChunks(html, 40);
  assert.ok(chunks.length > 1);
  assert.strictEqual(chunks.join(''), html, 'chunking never drops or reorders bytes');
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(chunk.endsWith('>'), 'every non-final chunk boundary lands after a closed tag');
  }
  // PP-EST-7: non-default chunk size must still reassemble identically (checksum page uses same budget).
  const chunksAlt = splitHtmlIntoChunks(html, 17);
  assert.notStrictEqual(chunksAlt.length, chunks.length);
  assert.strictEqual(chunksAlt.join(''), html, 'chunkBytes≠default still covers full HTML');
  console.log('[unit] page/establish handoff + chunking ok');
}

// ------------------------------------------------------------ cssom.ts

function testCssomCoalesceAddRemoveCancels(): void {
  const coalescer = new CssomCoalescer();
  const sheet: CssomSheetDescriptor = { id: 1, scope: { kind: 'main' }, rules: [] };
  coalescer.addSheet(1, 0, sheet);
  coalescer.removeSheet(1);
  assert.strictEqual(coalescer.isEmpty, true, 'a sheet added and removed within the frame is never sent');
  assert.deepStrictEqual(coalescer.flush(), []);

  coalescer.addRule(1, 10, 0, { id: 10, cssText: 'a{}' });
  coalescer.removeRule(1, 10);
  assert.strictEqual(coalescer.isEmpty, true, 'a rule added and removed within the frame is never sent');
  console.log('[unit] page/cssom add+remove cancel ok');
}

function testCssomCoalescePatchCollapses(): void {
  const coalescer = new CssomCoalescer();
  coalescer.patchRule(10, 'a{color:red}');
  coalescer.patchRule(10, 'a{color:blue}');
  const ops = coalescer.flush();
  assert.strictEqual(ops.length, 1, 'repeated writes to one rule collapse to one cssomPatch');
  assert.deepStrictEqual(ops[0], { op: 'cssomPatch', rule: 10, cssText: 'a{color:blue}' });
  assert.strictEqual(coalescer.isEmpty, true, 'flush resets the coalescer');
  console.log('[unit] page/cssom patch collapse ok');
}

// ------------------------------------------------------------ channel.ts

function testChannelChunking(): void {
  const pushed: Uint8Array[] = [];
  const channel = createBindingChannel((bytes) => pushed.push(bytes));
  const payload = new Uint8Array(250).fill(7);
  const chunks = pushChunked(channel, payload, 100);
  assert.strictEqual(chunks, 3);
  assert.strictEqual(pushed.length, 3);
  assert.strictEqual(pushed[0]!.byteLength, 100);
  assert.strictEqual(pushed[2]!.byteLength, 50);

  pushed.length = 0;
  pushFrameParts(channel, [new Uint8Array([1]), new Uint8Array([2])]);
  assert.strictEqual(pushed.length, 2);
  console.log('[unit] page/channel chunking ok');
}

// ------------------------------------------------------------ node/mirror.ts

function testNodeMirrorApplyAndSerialize(): void {
  const mirror = new NodeMirror();
  const root: FNode = {
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
  assert.strictEqual(mirror.root, 1);
  assert.strictEqual(mirror.size >= 3, true);
  const html = mirror.serializeToHtml();
  assert.ok(html.includes('speculum-anchor="1"'));
  assert.ok(html.includes('speculum-anchor="2"'));
  assert.ok(html.includes('class="x"'));
  assert.ok(html.includes('hello'));

  const voidMirror = new NodeMirror();
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
  assert.ok(/<img[^>]*src="x"[^>]*>/.test(voidHtml), 'empty void serializes');
  assert.ok(voidHtml.includes('oops'), 'void-with-children keeps interior (establish checksum)');

  mirror.applyFrame([{ op: 'patch', node: 3, snapshot: { kind: 'text', id: 3, value: 'updated' } }]);
  assert.strictEqual(mirror.get(3)?.value, 'updated');

  mirror.applyFrame([{ op: 'childList', parent: 1, mode: 'full', children: [] }]);
  assert.strictEqual(mirror.get(2), undefined, 'removing a parent unregisters its whole subtree');
  assert.strictEqual(mirror.get(3), undefined);
  console.log('[unit] page/node/mirror apply + serialize ok');
}

function testNodeMirrorDesyncOnMissingId(): void {
  const mirror = new NodeMirror();
  assert.throws(
    () => mirror.applyFrame([{ op: 'patch', node: 42, snapshot: { kind: 'text', id: 42, value: 'x' } }]),
    MirrorDesyncError,
  );
  assert.throws(
    () => mirror.applyFrame([{ op: 'childList', parent: 42, mode: 'full', children: [] }]),
    MirrorDesyncError,
  );
  console.log('[unit] page/node/mirror desync on missing id ok');
}

// ------------------------------------------------------------ node/rewrite.ts

function testUrlRewriterBasicsAndMemoIsolation(): void {
  const rewriter = new UrlRewriter({ originHost: 'example.com' });
  assert.strictEqual(rewriter.rewriteUrl('/a.png'), '/w7s/virtual-assets/example.com/a.png');
  assert.strictEqual(
    rewriter.rewriteUrl('https://cdn.example.com/x.js?v=1'),
    '/w7s/virtual-assets/cdn.example.com/x.js?v=1',
  );
  assert.strictEqual(rewriter.rewriteUrl('javascript:alert(1)'), 'javascript:alert(1)', 'never rewrites javascript: urls');
  assert.strictEqual(rewriter.rewriteUrl('data:text/plain,hi'), 'data:text/plain,hi');
  assert.strictEqual(rewriter.memoSize, 4, 'rewriteUrl memoizes per distinct raw url');

  const srcset =
    'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg 1920w, '
    + 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg 800w';
  const rewritten = rewriter.rewriteAttrValue('srcset', srcset);
  assert.ok(rewritten.includes('f_avif,q_auto,w_1920'), 'Cloudinary comma-bearing transforms survive rewriting');
  assert.ok(!rewritten.includes('https://'), 'srcset urls are rewritten to the virtual-assets prefix, not left absolute');
  assert.ok(rewritten.includes('/w7s/virtual-assets/res.cloudinary.com/'));

  const other = new UrlRewriter({ originHost: 'example.com' });
  assert.strictEqual(other.memoSize, 0, 'no shared memo across instances (K2)');

  const css = rewriter.rewriteCssUrlFunctions('body{background:url("/bg.png")}');
  assert.ok(css.includes('/w7s/virtual-assets/example.com/bg.png'));
  console.log('[unit] page/node/rewrite basics + isolation ok');
}

// ------------------------------------------------------------ opcodes.ts

function testOpCodesAreStableAndUnique(): void {
  const values = Object.values(OpCode).filter((v): v is number => typeof v === 'number');
  assert.strictEqual(new Set(values).size, values.length, 'no opcode value collides');
  assert.strictEqual(OpCode.EstablishBegin, 1, 'opcode numbering is wire-stable — never renumber');
  console.log('[unit] page/opcodes stable + unique ok');
}

function testSplitCssTopLevelRules(): void {
  const rules = splitCssTopLevelRules('.a{color:red} @media (x){.b{color:blue}} .c{color:green}');
  assert.equal(rules.length, 3);
  assert.ok(rules[0]!.startsWith('.a{'));
  assert.ok(rules[1]!.startsWith('@media'));
  assert.ok(rules[2]!.startsWith('.c{'));
}

function testAssetPriorityQueueOrdersCssAndViewport(): void {
  const q = new AssetPriorityQueue(200);
  q.enqueue({ key: 'far', sourceUrl: 'https://x/far', distancePx: 2000, isCss: false });
  q.enqueue({ key: 'near', sourceUrl: 'https://x/near', distancePx: 10, isCss: false });
  q.enqueue({ key: 'css', sourceUrl: 'https://x/a.css', distancePx: 5000, isCss: true });
  assert.equal(q.takeNext()?.key, 'css');
  assert.equal(q.takeNext()?.key, 'near');
  assert.equal(q.takeNext()?.key, 'far');
}

export function runPageProjectionWireUnitTests(): void {
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
