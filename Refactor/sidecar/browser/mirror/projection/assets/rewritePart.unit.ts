/**
 * FrameRewriteHop — rewrite URL strings then rehash so Projected CHECK stays green.
 */

import assert from 'node:assert/strict';
import { decodeFramePart, PersistentStringTable } from '@speculum/page-projection/core/decode';
import { ElementNs } from '@speculum/page-projection/core/elementNs';
import {
  CHECK_SCOPE_TABLE,
  createFrame,
  type FrameOp,
} from '@speculum/page-projection/core/frame';
import { NodeKind, OpCode } from '@speculum/page-projection/core/opcodes';
import { ReplicatedTable } from '@speculum/page-projection/core/replicatedTable';
import {
  applyFrameToTableChecked,
  applyOpToTable,
} from '@speculum/page-projection/core/replicatedTableApply';
import { BinaryFrameEncoder } from '@speculum/page-projection/virtual/frame/binaryFrameEncoder';
import { AssetStore } from './AssetStore';
import { FrameRewriteHop } from './rewritePart';
import { VIRTUAL_ASSETS_PREFIX } from './urlForms';

function buildProducerFrame(ops: FrameOp[], sequence = 1, resync = true): Uint8Array {
  const table = new ReplicatedTable();
  if (resync) table.reset();
  table.setSequence(sequence);
  const preTableHash = table.tableHash;
  for (const op of ops) {
    if (op.op === OpCode.Check) continue;
    applyOpToTable(table, op);
  }
  const withCheck: FrameOp[] = [
    ...ops,
    { op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: table.tableHash },
  ];
  const frame = createFrame({
    generation: 1,
    sequence,
    preTableHash,
    resync,
    ops: withCheck,
  });
  return new BinaryFrameEncoder().encode(frame)[0]!;
}

export function testFrameRewriteHopRehashesCheck(): void {
  const assets = new AssetStore();
  const hop = new FrameRewriteHop();
  const ops: FrameOp[] = [
    {
      op: OpCode.NodeNew,
      id: 10,
      kind: NodeKind.Element,
      ns: ElementNs.Html,
      name: 'img',
      attrs: [
        { name: 'src', value: 'https://cdn.example.com/hero.png' },
        { name: 'style', value: 'background:url(/bg.png)' },
      ],
    },
    {
      op: OpCode.AttrSet,
      node: 10,
      attrs: [{ name: 'srcset', value: 'https://cdn.example.com/a.png 1x, https://cdn.example.com/b.png 2x' }],
    },
  ];

  const producerBytes = buildProducerFrame(ops);
  const outParts = hop.push(producerBytes, {
    pageUrl: 'https://www.example.com/app/',
    assets,
  });
  assert.equal(outParts.length, 1, 'single-part frame must emit one rewritten part');

  const decoded = decodeFramePart(outParts[0]!, new PersistentStringTable());
  assert.ok(decoded.ok);
  if (!decoded.ok) return;

  const img = decoded.part.ops.find((o) => o.op === OpCode.NodeNew);
  assert.ok(img && img.op === OpCode.NodeNew);
  if (img?.op === OpCode.NodeNew && img.kind === NodeKind.Element) {
    const src = img.attrs.find((a) => a.name === 'src')?.value ?? '';
    assert.equal(src, `${VIRTUAL_ASSETS_PREFIX}cdn.example.com/hero.png`);
    const style = img.attrs.find((a) => a.name === 'style')?.value ?? '';
    assert.ok(style.includes(VIRTUAL_ASSETS_PREFIX), style);
  }

  const attr = decoded.part.ops.find((o) => o.op === OpCode.AttrSet);
  assert.ok(attr && attr.op === OpCode.AttrSet);
  if (attr?.op === OpCode.AttrSet) {
    const srcset = attr.attrs.find((a) => a.name === 'srcset')?.value ?? '';
    assert.ok(srcset.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png`));
    assert.ok(srcset.includes('1x'));
  }

  const client = new ReplicatedTable();
  const applied = applyFrameToTableChecked(
    client,
    decoded.part.resync,
    decoded.part.ops,
    decoded.part.sequence,
  );
  assert.equal(applied.ok, true, 'rewritten frame must CHECK-green on a fresh client table');

  const producerDecoded = decodeFramePart(producerBytes, new PersistentStringTable());
  assert.ok(producerDecoded.ok);
  if (producerDecoded.ok) {
    const checkP = producerDecoded.part.ops.find((o) => o.op === OpCode.Check);
    const checkR = decoded.part.ops.find((o) => o.op === OpCode.Check);
    assert.ok(checkP && checkR && checkP.op === OpCode.Check && checkR.op === OpCode.Check);
    if (checkP?.op === OpCode.Check && checkR?.op === OpCode.Check) {
      assert.notEqual(checkP.hash, checkR.hash, 'CHECK must change when URL strings change');
    }
  }

  console.log('[unit] FrameRewriteHop rehashes CHECK ok');
}

export function testFrameRewriteHopBuffersMultiPart(): void {
  const assets = new AssetStore();
  const hop = new FrameRewriteHop();
  const encoder = new BinaryFrameEncoder({ maxFrameBytes: 180 });

  const manyAttrs = Array.from({ length: 40 }, (_, i) => ({
    name: i % 2 === 0 ? 'data-src' : 'src',
    value: `https://cdn.example.com/p${i}.png?q=${i}`,
  }));
  const ops: FrameOp[] = [
    {
      op: OpCode.NodeNew,
      id: 10,
      kind: NodeKind.Element,
      ns: ElementNs.Html,
      name: 'div',
      attrs: manyAttrs,
    },
    { op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: 0n },
  ];
  const frame = createFrame({
    generation: 1,
    sequence: 1,
    preTableHash: 0n,
    resync: true,
    ops,
  });
  const parts = encoder.encode(frame);
  assert.ok(parts.length >= 2, `expected multi-part encode, got ${parts.length}`);

  const emitted: Uint8Array[] = [];
  for (const part of parts) {
    emitted.push(...hop.push(part, { pageUrl: 'https://www.example.com/', assets }));
  }
  assert.ok(emitted.length >= 1, 'hop must emit after the last part arrives');

  const persistent = new PersistentStringTable();
  let sawVirtual = false;
  for (const bytes of emitted) {
    const d = decodeFramePart(bytes, persistent);
    assert.ok(d.ok, 'rewritten multi-part must decode');
    if (!d.ok) continue;
    for (const op of d.part.ops) {
      if (op.op === OpCode.NodeNew && op.kind === NodeKind.Element) {
        for (const a of op.attrs) {
          if (a.value.includes(VIRTUAL_ASSETS_PREFIX)) sawVirtual = true;
        }
      }
    }
  }
  assert.ok(sawVirtual, 'multi-part rewrite must virtualize URL attrs');
  console.log('[unit] FrameRewriteHop multi-part buffer ok');
}

export async function testAssetStoreDataAndClear(): Promise<void> {
  const store = new AssetStore();
  store.materializeRewrite({
    kind: 'data',
    value: '/w7s/virtual-data/abc',
    id: 'abc123deadbeefcafe000001',
    body: Buffer.from('hello-data'),
    contentType: 'text/plain',
  });
  const hit = await store.getAsset('abc123deadbeefcafe000001', { kind: 'data' });
  assert.ok(hit);
  assert.equal(Buffer.from(hit!.body).toString('utf8'), 'hello-data');
  assert.equal(hit!.contentType, 'text/plain');

  store.clear();
  const miss = await store.getAsset('abc123deadbeefcafe000001', { kind: 'data' });
  assert.equal(miss, null);
  console.log('[unit] AssetStore data put/get/clear ok');
}