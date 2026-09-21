#!/usr/bin/env node
import fs from 'fs';
import { decodeFramePart, PersistentStringTable, FramePartAssembler } from '../../packages/page-projection/dist/core/decode.js';
import { OpCode, NodeKind } from '../../packages/page-projection/dist/core/opcodes.js';

const dir = process.argv[2] || '/tmp/vproj-oracle-1789569924812';
const bytes = new Uint8Array(fs.readFileSync(`${dir}/f-0001.bin`));
const strings = new PersistentStringTable();
const asm = new FramePartAssembler();
const d = decodeFramePart(bytes, strings);
const a = asm.ingest(d.part);
const texts = [];
const els = [];
for (const op of a.ops) {
  if (op.op === OpCode.NodeNew && (op.kind === NodeKind.Text || op.kind === NodeKind.Comment)) {
    texts.push({ kind: op.kind, value: (op.value || '').slice(0, 240) });
  }
  if (op.op === OpCode.NodeNew && op.kind === NodeKind.Element) {
    els.push({
      name: op.name,
      attrs: (op.attrs || []).map((x) => [x.name, String(x.value).slice(0, 120)]),
    });
  }
}
console.log(JSON.stringify({ texts, els }, null, 2));
