import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFramePart, PersistentStringTable } from '../../packages/page-projection/src/core/decode';
import { applyFrameToTableChecked } from '../../packages/page-projection/src/core/replicatedTableApply';
import { ReplicatedTable } from '../../packages/page-projection/src/core/replicatedTable';

const cap = process.argv[2];
if (!cap) {
  console.error('uso: decode-capture.ts <dir>');
  process.exit(2);
}

const persistent = new PersistentStringTable();
const table = new ReplicatedTable();
const files = readdirSync(cap)
  .filter((f) => /^f-\d+.*\.bin$/.test(f))
  .sort();

for (const name of files) {
  const bytes = new Uint8Array(readFileSync(join(cap, name)));
  const d = decodeFramePart(bytes, persistent);
  if (!d.ok) {
    console.log(name, 'DECODE_FAIL', d.reason);
    continue;
  }
  const p = d.part;
  const pre = p.preTableHash;
  const local = table.tableHash;
  const r = applyFrameToTableChecked(table, p.resync, p.ops, p.sequence);
  console.log(
    [
      name,
      `ctx=${p.contextId}`,
      `gen=${p.generation}`,
      `seq=${p.sequence}`,
      `resync=${p.resync ? 1 : 0}`,
      `ops=${p.ops.length}`,
      `pre=${pre}`,
      `local=${local}`,
      pre === local || p.resync ? 'preOK' : 'preMISMATCH',
      r.ok ? 'TABLE_OK' : `TABLE_FAIL:${JSON.stringify(r)}`,
    ].join(' '),
  );
}
