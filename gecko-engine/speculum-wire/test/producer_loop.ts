// Lado cliente do laço: aplica cada frame do produtor C++ com o apply ESTRITO
// (`applyFrameToTableChecked`), que valida precondição de cada op e confere o CHECK.
// Se o produtor emitir algo incoerente, isto falha — é o mesmo juiz de produção.
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeFramePart, PersistentStringTable } from '../../../packages/page-projection/src/core/decode';
import { ReplicatedTable } from '../../../packages/page-projection/src/core/replicatedTable';
import { applyFrameToTableChecked } from '../../../packages/page-projection/src/core/replicatedTableApply';

const OUT = process.env.SPECULUM_OUT ?? '/tmp/speculum-wire';
const names = readFileSync(`${OUT}/frames.txt`, 'utf8').split('\n').filter(Boolean);

const table = new ReplicatedTable();
const persistent = new PersistentStringTable();
const steps: unknown[] = [];
let failed: string | null = null;

for (const name of names) {
  const bytes = new Uint8Array(readFileSync(`${OUT}/${name}`));
  const res = decodeFramePart(bytes, persistent);
  if (!res.ok) {
    failed = `${name}: decode ${res.reason} — ${res.message}`;
    break;
  }
  const part = res.part;
  if (!part.resync && part.preTableHash !== table.tableHash) {
    failed = `${name}: preTableHash ${part.preTableHash} != table ${table.tableHash} (antes de aplicar)`;
    break;
  }
  if (name === names[0] && !part.resync) {
    failed = `${name}: primeiro frame sem flag de resync`;
    break;
  }
  const applied = applyFrameToTableChecked(
    table,
    part.resync,
    part.ops,
    part.sequence,
  );
  if (!applied.ok) {
    failed = `${name}: apply ${applied.reason} em op #${(applied as { failedOpIndex: number }).failedOpIndex} (${(applied as { opName: string }).opName})`;
    break;
  }
  steps.push({
    frame: name,
    sequence: part.sequence,
    ops: part.ops.length,
    tableHash: table.tableHash.toString(),
    size: table.size,
  });
}

writeFileSync(`${OUT}/producer_ts.json`, JSON.stringify({
  failed,
  frames: steps.length,
  rows: table.size,
  tableHash: table.tableHash.toString(),
  steps,
  bodyChildren: table.orderedChildIds(4),
}, null, 2));

if (failed) {
  console.error('APPLY FALHOU:', failed);
  process.exit(1);
}
console.log(`cliente: ${steps.length} frames aplicados (estrito), ${table.size} linhas, tableHash=${table.tableHash}`);
