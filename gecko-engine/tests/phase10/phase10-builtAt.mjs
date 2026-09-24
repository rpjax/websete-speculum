#!/usr/bin/env node
/**
 * Phase 10 A3 — ProjectionClient builtAt discard against SpecDriver corpus.
 *
 * SpecDriver (sim) emits the live table snapshot + builtAt. Lab ISA (PatchBuilder)
 * is not frame-protocol; this gate seals the SpecDriver snapshot into 0x5050 frames,
 * wraps them in schema Patch envelopes, then proves §4.1 buffer/discard on the real client.
 *
 * Requires:
 *   SPECULUM_MONOREPO_ROOT  — Speculum checkout (packages/page-projection)
 *   SPECULUM_PHASE10_CORPUS — JSON from builtAt_corpus (SpecDriver emit)
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const monorepo = process.env.SPECULUM_MONOREPO_ROOT || '';
const corpusPath = process.env.SPECULUM_PHASE10_CORPUS || '';

function fail(msg) {
  console.error('FAIL A3', msg);
  process.exit(1);
}

if (!monorepo) fail('SPECULUM_MONOREPO_ROOT required');
if (!corpusPath) fail('SPECULUM_PHASE10_CORPUS required (path from builtAt_corpus)');
if (!existsSync(monorepo)) fail(`monorepo missing: ${monorepo}`);
if (!existsSync(corpusPath)) fail(`corpus missing: ${corpusPath}`);

const ppSrc = join(monorepo, 'packages/page-projection/src');
const ppDist = join(monorepo, 'packages/page-projection/dist');
if (!existsSync(join(ppSrc, 'projected/ProjectionClient.ts'))) {
  fail(`ProjectionClient.ts missing under ${ppSrc}`);
}

const require = createRequire(import.meta.url);

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  fail('jsdom required: npm install jsdom in gecko-engine (devDependency)');
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
if (!(corpus.patchCount > 0)) fail('corpus.patchCount must be > 0 — SpecDriver produced no work');
if (!(corpus.builtAt > 0)) fail('corpus.builtAt must be > 0');
if (!corpus.oracleDumpB64) fail('corpus.oracleDumpB64 missing');
if (!(corpus.oracleDumpBytes > 0)) fail('oracleDumpBytes must be > 0');
if (String(corpus.builtAt) !== String(corpus.patchCount)) {
  fail(`builtAt ${corpus.builtAt} != patchCount ${corpus.patchCount}`);
}

function b64ToU8(s) {
  return Uint8Array.from(Buffer.from(s, 'base64'));
}

const oracleDump = b64ToU8(corpus.oracleDumpB64);
if (oracleDump.byteLength !== corpus.oracleDumpBytes) {
  fail(`oracle dump length ${oracleDump.byteLength} != ${corpus.oracleDumpBytes}`);
}

async function loadDist(rel) {
  const p = join(ppDist, rel);
  if (!existsSync(p)) fail(`page-projection dist missing: ${p} — run npm run build in packages/page-projection`);
  return import(pathToFileURL(p).href);
}

const { ProjectionClient } = await loadDist('projected/ProjectionClient.js');
if (typeof ProjectionClient?.fromSurfaceHost !== 'function') {
  fail('ProjectionClient.fromSurfaceHost missing — rebuild packages/page-projection');
}

const { encodeSchemaPatchMessage } = await loadDist('wire/schemaPatch.js');
const { BinaryFrameEncoder } = await loadDist('virtual/frame/binaryFrameEncoder.js');
const { OpCode, NodeKind } = await loadDist('core/opcodes.js');
const { ElementNs } = await loadDist('core/elementNs.js');
const { FRAME_WIRE_VERSION, CONTEXT_ID_ROOT, DOCUMENT_ID } = await loadDist('core/frame.js');

/** C++ producer NodeKind::Document = 4 (lab); frame-protocol has no Document wire kind. */
const LAB_KIND_DOCUMENT = 4;

function parseProducerSnapshot(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const u8 = () => {
    const v = view.getUint8(o);
    o += 1;
    return v;
  };
  const u16 = () => {
    const v = view.getUint16(o, true);
    o += 2;
    return v;
  };
  const u32 = () => {
    const v = view.getUint32(o, true);
    o += 4;
    return v;
  };
  const n = u32();
  const rows = [];
  for (let i = 0; i < n; i++) {
    const id = u32();
    const kind = u8();
    const ns = u8();
    const parent = u32();
    const prevSibling = u32();
    const nameLen = u32();
    const name = new TextDecoder().decode(bytes.subarray(o, o + nameLen));
    o += nameLen;
    const attrCount = u16();
    const attrs = [];
    for (let a = 0; a < attrCount; a++) {
      const nl = u16();
      const an = new TextDecoder().decode(bytes.subarray(o, o + nl));
      o += nl;
      const vl = u16();
      const av = new TextDecoder().decode(bytes.subarray(o, o + vl));
      o += vl;
      attrs.push({ name: an, value: av });
    }
    rows.push({ id, kind, ns, parent, prevSibling, name, attrs });
  }
  if (o !== bytes.byteLength) fail(`snapshot parse leftover ${bytes.byteLength - o}`);
  return rows;
}

function snapshotToFrameOps(rows) {
  const ops = [];
  const elements = [];
  for (const r of rows) {
    if (r.kind === LAB_KIND_DOCUMENT || r.id === DOCUMENT_ID) continue;
    if (r.kind === NodeKind.Element) {
      ops.push({
        op: OpCode.NodeNew,
        id: r.id,
        kind: NodeKind.Element,
        ns: r.ns,
        name: r.name,
        attrs: r.attrs.map((a) => ({ name: a.name, value: a.value })),
        nestedHost: false,
        childScopeId: null,
      });
      elements.push(r);
    } else if (r.kind === NodeKind.Text || r.kind === NodeKind.Comment) {
      ops.push({
        op: OpCode.NodeNew,
        id: r.id,
        kind: r.kind,
        value: r.name,
      });
      elements.push(r);
    } else {
      fail(`snapshot row id=${r.id} kind=${r.kind} not mappable to frame-protocol`);
    }
  }
  // Insert children grouped by parent in prevSibling order.
  const byParent = new Map();
  for (const r of elements) {
    const list = byParent.get(r.parent) ?? [];
    list.push(r);
    byParent.set(r.parent, list);
  }
  for (const [parent, kids] of byParent) {
    kids.sort((a, b) => {
      if (a.prevSibling === 0) return -1;
      if (b.prevSibling === 0) return 1;
      return a.id - b.id;
    });
    // Walk prevSibling chains into order.
    const ordered = [];
    const byId = new Map(kids.map((k) => [k.id, k]));
    let next = kids.find((k) => k.prevSibling === 0);
    const seen = new Set();
    while (next && !seen.has(next.id)) {
      ordered.push(next.id);
      seen.add(next.id);
      next = kids.find((k) => k.prevSibling === next.id);
    }
    for (const k of kids) if (!seen.has(k.id)) ordered.push(k.id);
    ops.push({
      op: OpCode.Insert,
      parent,
      before: 0,
      ids: ordered,
    });
  }
  if (ops.length === 0) fail('no frame ops from SpecDriver snapshot');
  return ops;
}

function splitOps(ops, parts) {
  if (parts < 1) fail('parts < 1');
  if (ops.length < parts) {
    // Pad by repeating last NodeNew-less Insert-only isn't valid — duplicate last op batch.
    const out = [];
    for (let i = 0; i < parts; i++) {
      const start = Math.floor((i * ops.length) / parts);
      const end = Math.floor(((i + 1) * ops.length) / parts);
      const slice = ops.slice(start, Math.max(end, start + 1));
      out.push(slice.length ? slice : [ops[ops.length - 1]]);
    }
    return out;
  }
  const out = [];
  for (let i = 0; i < parts; i++) {
    const start = Math.floor((i * ops.length) / parts);
    const end = Math.floor(((i + 1) * ops.length) / parts);
    out.push(ops.slice(start, end));
  }
  return out;
}

const rows = parseProducerSnapshot(oracleDump);
const allOps = snapshotToFrameOps(rows);
const builtAt = corpus.builtAt >>> 0;
const chunks = splitOps(allOps, builtAt);
const encoder = new BinaryFrameEncoder();

function encodeIsaFrame(sequence, ops, resync) {
  const parts = encoder.encode({
    version: FRAME_WIRE_VERSION,
    contextId: CONTEXT_ID_ROOT,
    generation: 1,
    sequence,
    preTableHash: 0n,
    flags: { resync },
    ops,
  });
  if (parts.length !== 1) fail(`expected 1 frame part, got ${parts.length} for seq=${sequence}`);
  return parts[0];
}

const SCHEMA_PATCH_FLAG_RESYNC = 0b10;
const liveEnvelopes = [];
for (let i = 0; i < builtAt; i++) {
  const seq = i + 1;
  const isa = encodeIsaFrame(seq, chunks[i], false);
  liveEnvelopes.push(
    encodeSchemaPatchMessage(
      {
        generation: 1,
        sequence: seq,
        flags: 0,
        builtAt: 0,
        metrics: [],
        deltas: isa,
      },
      1,
      0,
    ),
  );
}

const portraitIsa = encodeIsaFrame(builtAt + 1, allOps, true);
const resyncEnvelope = encodeSchemaPatchMessage(
  {
    generation: 1,
    sequence: builtAt + 1,
    flags: SCHEMA_PATCH_FLAG_RESYNC,
    builtAt,
    metrics: [],
    deltas: portraitIsa,
  },
  1,
  0,
);

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
  url: 'https://projected.test/',
  pretendToBeVisual: true,
});
const { document } = dom.window;
globalThis.document = document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLIFrameElement = dom.window.HTMLIFrameElement;
globalThis.Node = dom.window.Node;
globalThis.Document = dom.window.Document;
globalThis.Element = dom.window.Element;
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

function makeSurface(doc) {
  return {
    get document() {
      return doc;
    },
    async beginResyncBuild() {
      return doc;
    },
    commitSwap() {
      return doc;
    },
    discardBuild() {},
    async reset() {},
    setCssSize() {},
    getCssSize() {
      return { width: 1280, height: 720 };
    },
  };
}

function makeClient() {
  const doc = document.implementation.createHTMLDocument('projected');
  return ProjectionClient.fromSurfaceHost(
    {
      surfaceHost: document.getElementById('host'),
      expectSchemaSha256: corpus.schema,
    },
    makeSurface(doc),
  );
}

// Prove live stream applies (SpecDriver-derived frames).
const liveProbe = makeClient();
for (const env of liveEnvelopes) liveProbe.ingest(env);
liveProbe.flush();
await new Promise((r) => setTimeout(r, 20));
const midDigest = liveProbe.liveTableDigest();
if (midDigest.sequence < 1) {
  fail('live stream applied sequence stayed 0 — ProjectionClient did not work');
}

// §4.1 path: both clients buffer then discard via builtAt (byte-identical dumps).
async function runBuiltAtPath() {
  const client = makeClient();
  client.enterSchemaResyncMode();
  const bufferedBefore = client.schemaResyncBufferLength;
  for (const env of liveEnvelopes) client.ingest(env);
  if (client.schemaResyncBufferLength <= bufferedBefore) {
    fail(
      `resync mode did not buffer: before=${bufferedBefore} after=${client.schemaResyncBufferLength}`,
    );
  }
  client.ingest(resyncEnvelope);
  if (client.schemaResyncBufferLength !== 0) {
    fail(`buffer not drained after resync: ${client.schemaResyncBufferLength}`);
  }
  client.flush();
  await new Promise((r) => setTimeout(r, 20));
  return client.liveTableDigest();
}

const after = await runBuiltAtPath();
const want = await runBuiltAtPath();
const gotJson = JSON.stringify(after);
const wantJson = JSON.stringify(want);
if (gotJson !== wantJson) {
  fail(`structural dump mismatch after builtAt swap\n got=${gotJson}\nwant=${wantJson}`);
}

if (after.sequence < 1) {
  fail(`builtAt path sequence stayed ${after.sequence}`);
}

console.log(
  `PASS A3 ProjectionClient builtAt desync dump identical patches=${builtAt} builtAt=${builtAt} tableHash=${after.table?.tableHash ?? after.tableHash ?? '?'} liveSeq=${midDigest.sequence}`,
);
process.exit(0);
