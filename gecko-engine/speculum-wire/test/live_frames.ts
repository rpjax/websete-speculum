import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFramePart, PersistentStringTable } from '../../../packages/page-projection/src/core/decode';
import { ReplicatedTable } from '../../../packages/page-projection/src/core/replicatedTable';
import { applyFrameToTableChecked } from '../../../packages/page-projection/src/core/replicatedTableApply';

const evidence = process.env.SPECULUM_LIVE_FRAMES;
if (!evidence) {
  console.error('live-frames: defina SPECULUM_LIVE_FRAMES');
  process.exit(2);
}
const ndjsonPath = join(evidence, 'frames.ndjson');

type FrameRow = {
  ordem: number;
  contextId: number;
  sequence: number;
};

const rows: FrameRow[] = readFileSync(ndjsonPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line) as FrameRow)
  .sort((a, b) => a.ordem - b.ordem);

const total = rows.length;
const tables = new Map<number, ReplicatedTable>();
const persistent = new PersistentStringTable();
let aceitos = 0;

for (const row of rows) {
  const name = `f-${String(row.ordem).padStart(4, '0')}-ctx${row.contextId}-seq${row.sequence}.bin`;
  const path = join(evidence, name);
  if (!existsSync(path)) {
    console.error(`live-frames: arquivo ausente ${name}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(readFileSync(path));
  const res = decodeFramePart(bytes, persistent);
  if (!res.ok) {
    console.error(`live-frames: decode falhou ${name}: ${res.reason} ${res.message}`);
    process.exit(1);
  }
  const p = res.part;
  if (!tables.has(row.contextId)) {
    tables.set(row.contextId, new ReplicatedTable());
  }
  const table = tables.get(row.contextId)!;
  const r = applyFrameToTableChecked(table, p.flags?.resync ?? false, p.ops, p.sequence);
  if (r.ok) {
    aceitos++;
  } else {
    console.error(`live-frames: recusado ${name}`, r);
    console.log(`live-frames: ${aceitos}/${total} aceitos`);
    process.exit(1);
  }
}

console.log(`live-frames: ${aceitos}/${total} aceitos`);
if (aceitos !== total) {
  process.exit(1);
}
