import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFramePart, PersistentStringTable } from '../../../packages/page-projection/src/core/decode';
import { ReplicatedTable } from '../../../packages/page-projection/src/core/replicatedTable';
import { applyFrameToTableChecked } from '../../../packages/page-projection/src/core/replicatedTableApply';

const evidence = process.env.SPECULUM_LIVE_INCREMENTAL;
if (!evidence) {
  console.error('live-incremental: defina SPECULUM_LIVE_INCREMENTAL');
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
  .map((line) => JSON.parse(line) as FrameRow);

const total = rows.length;
const byContext = new Map<number, FrameRow[]>();
for (const row of rows) {
  if (!byContext.has(row.contextId)) {
    byContext.set(row.contextId, []);
  }
  byContext.get(row.contextId)!.push(row);
}

const contextOrder = [...byContext.keys()].sort(
  (a, b) =>
    Math.min(...byContext.get(a)!.map((r) => r.ordem)) -
    Math.min(...byContext.get(b)!.map((r) => r.ordem)),
);

const persistent = new PersistentStringTable();
let aceitos = 0;

for (const contextId of contextOrder) {
  const frames = byContext.get(contextId)!.sort((a, b) => a.sequence - b.sequence);
  const table = new ReplicatedTable();
  for (const row of frames) {
    const name = `f-${String(row.ordem).padStart(4, '0')}-ctx${row.contextId}-seq${row.sequence}.bin`;
    const path = join(evidence, name);
    if (!existsSync(path)) {
      console.error(`live-incremental: arquivo ausente ${name}`);
      process.exit(1);
    }
    const bytes = new Uint8Array(readFileSync(path));
    const res = decodeFramePart(bytes, persistent);
    if (!res.ok) {
      console.error(`live-incremental: decode falhou ${name}: ${res.reason} ${res.message}`);
      process.exit(1);
    }
    const p = res.part;
    const r = applyFrameToTableChecked(table, p.flags?.resync ?? false, p.ops, p.sequence);
    if (r.ok) {
      aceitos++;
    } else {
      console.error(`live-incremental: recusado ${name}`, r);
      console.log(`live-incremental: ${aceitos}/${total} aceitos`);
      process.exit(1);
    }
  }
}

console.log(`live-incremental: ${aceitos}/${total} aceitos`);
if (aceitos !== total) {
  process.exit(1);
}
