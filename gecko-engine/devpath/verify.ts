// Speculum devpath — veredito do CLIENTE sobre uma captura real.
//
// Decodifica cada frame com core/decode.ts e aplica com applyFrameToTableChecked,
// o apply estrito de producao: ele valida precondicao de cada op e confere o CHECK.
// Frames de documentos diferentes nao compartilham tabela — agrupa por
// contextId+generation, que e' como o cliente de verdade distingue contexto.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFramePart, PersistentStringTable } from '../../packages/page-projection/src/core/decode';
import { NodeKind } from '../../packages/page-projection/src/core/frame';
import { OpCode } from '../../packages/page-projection/src/core/opcodes';
import { ReplicatedTable } from '../../packages/page-projection/src/core/replicatedTable';
import { applyFrameToTableChecked } from '../../packages/page-projection/src/core/replicatedTableApply';

const cap = process.argv[2];
if (!cap) {
  console.error('uso: verify.ts <diretorio-da-captura>');
  process.exit(2);
}

const framesDir = join(cap, 'frames');
if (!existsSync(framesDir)) {
  console.error(`sem diretorio de frames em ${cap}`);
  process.exit(2);
}

const names = readdirSync(framesDir)
  .filter((n) => n.endsWith('.bin'))
  .sort((a, b) => {
    const na = Number(a.replace(/\D/g, '')), nb = Number(b.replace(/\D/g, ''));
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
  });

if (names.length === 0) {
  console.log('NENHUM frame na captura. Rode ./doctor.sh para saber por que.');
  process.exit(1);
}

const tables = new Map<string, ReplicatedTable>();
const tagsByKey = new Map<string, string[]>();
const persistent = new PersistentStringTable();
let aceitos = 0, recusados = 0;

const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

for (const name of names) {
  const bytes = new Uint8Array(readFileSync(join(framesDir, name)));
  const res = decodeFramePart(bytes, persistent);
  if (!res.ok) {
    console.log(`${name.padEnd(16)} DECODE FALHOU  ${res.reason}: ${res.message}`);
    recusados++;
    continue;
  }
  const p = res.part;
  const key = `${name} ctx${p.contextId}/gen${p.generation}`;
  const table = new ReplicatedTable();
  tables.set(key, table);
  const tags: string[] = [];
  tagsByKey.set(key, tags);
  for (const op of p.ops) {
    if (op.op === OpCode.NodeNew && op.kind === NodeKind.Element) {
      tags.push(op.name);
    }
  }
  const r = applyFrameToTableChecked(table, p.flags?.resync ?? false, p.ops, p.sequence);
  if (r.ok) {
    aceitos++;
    console.log(`${name.padEnd(16)} ${key} seq=${p.sequence} ops=${String(p.ops.length).padStart(3)}  ACEITO   linhas=${table.size} hash=${table.tableHash}`);
  } else {
    recusados++;
    console.log(`${name.padEnd(16)} ${key} seq=${p.sequence} ops=${String(p.ops.length).padStart(3)}  RECUSADO ${j(r)}`);
  }
}

console.log('');
for (const [key, t] of tables) {
  const elementRows = t.size;
  let elements = 0;
  t.forEachRow((_id, row) => {
    if (row.kind === 1) elements++;
  });
  const tags = tagsByKey.get(key) ?? [];
  console.log(`${key}: ${elementRows} linhas (${elements} elementos), tableHash=${t.tableHash}`);
  console.log(`  tags: ${j(tags)}`);
  console.log(`  filhos do Document: ${j(t.orderedChildIds(1))}`);
}

console.log('');
console.log(`${aceitos} aceito(s), ${recusados} recusado(s) de ${names.length} frame(s)`);
process.exit(recusados === 0 ? 0 : 1);
