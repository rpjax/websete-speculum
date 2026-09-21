import { decodeFramePart, FramePartAssembler, PersistentStringTable, peekFrameHeader } from '../../packages/page-projection/dist/core/decode.js';
import { OpCode } from '../../packages/page-projection/dist/core/opcodes.js';
import fs from 'node:fs';

const dir = process.argv[2];
const wantId = Number(process.argv[3] || 0);
const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
let frame = null;
let nResync = 0;
for (let n = 1; n <= 80; n++) {
  const p = `${dir}/f-${String(n).padStart(4, '0')}.bin`;
  if (!fs.existsSync(p)) break;
  const bytes = new Uint8Array(fs.readFileSync(p));
  const hdr = peekFrameHeader(bytes);
  const d = decodeFramePart(bytes, strings);
  if (!d.ok) continue;
  const a = assembler.ingest(d.part);
  if (!a || typeof a === 'string') continue;
  if (hdr?.contextId === 1 && a.resync) {
    frame = a;
    nResync = n;
    break;
  }
}
console.log(JSON.stringify({ nResync, ops: frame?.ops.length }, null, 2));
const rules = frame.ops.filter((o) => o.op === OpCode.RuleNew);
console.log('ruleNew', rules.length);
const hit = wantId ? rules.find((r) => r.id === wantId) : null;
if (hit) console.log(JSON.stringify({ id: hit.id, sheet: hit.sheet, before: hit.before, text: hit.text }, null, 2));
// Find rules that Chrome insertRule often rejects
const suspects = [];
for (const r of rules) {
  const t = r.text || '';
  if (
    /@(import|charset|namespace)\b/i.test(t) ||
    /^-moz-/m.test(t) ||
    /behavior\s*:/i.test(t) ||
    /expression\s*\(/i.test(t) ||
    t.trim() === '' ||
    /\\$/m.test(t)
  ) {
    suspects.push({ id: r.id, text: t.slice(0, 200) });
  }
}
console.log('suspects', suspects.length, suspects.slice(0, 15));
