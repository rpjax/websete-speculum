import { decodeFramePart, FramePartAssembler, PersistentStringTable } from '../../packages/page-projection/dist/core/decode.js';
import { OpCode, NodeKind } from '../../packages/page-projection/dist/core/opcodes.js';
import fs from 'node:fs';

const dir = process.argv[2] || '/tmp/beleza-diag-apply-1789527892900';
function load(n) {
  return new Uint8Array(fs.readFileSync(`${dir}/f-${String(n).padStart(4, '0')}.bin`));
}
const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
let frame = null;
for (const n of [1, 3]) {
  const d = decodeFramePart(load(n), strings);
  const a = assembler.ingest(d.part);
  if (a && typeof a !== 'string' && a.resync) frame = a;
}
const byId = new Map();
for (const op of frame.ops) if (op.op === OpCode.NodeNew) byId.set(op.id, op);
const hostId = Number(process.argv[3] || 5325);
console.log('host', byId.get(hostId));
const shadow = frame.ops.find(
  (o) => o.op === OpCode.NodeNew && o.kind === NodeKind.ShadowRoot && o.host === hostId,
);
console.log('shadow', shadow && { id: shadow.id, host: shadow.host, mode: shadow.mode, initFlags: shadow.initFlags });
const counts = {};
for (const s of frame.ops.filter((o) => o.op === OpCode.NodeNew && o.kind === NodeKind.ShadowRoot)) {
  const h = byId.get(s.host);
  const key = h ? `${h.name || 'kind' + h.kind} ns${h.ns}` : 'missing';
  counts[key] = (counts[key] || 0) + 1;
}
console.log(counts);
