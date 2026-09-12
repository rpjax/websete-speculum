// Speculum devpath — veredito do CLIENTE sobre uma captura real (frames via IPC no pai).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFramePart, PersistentStringTable } from '../../packages/page-projection/src/core/decode';
import { ReplicatedTable } from '../../packages/page-projection/src/core/replicatedTable';
import { applyFrameToTableChecked } from '../../packages/page-projection/src/core/replicatedTableApply';

const cap = process.argv[2];
if (!cap) {
  console.error('uso: verify.ts <diretorio-da-captura>');
  process.exit(2);
}

type FrameRow = {
  ordem: number;
  childPid: number;
  contextId: number;
  sequence: number;
  bytes: number;
};

const ndjsonPath = join(cap, 'frames.ndjson');
if (!existsSync(ndjsonPath)) {
  console.error(`sem frames.ndjson em ${cap}`);
  process.exit(2);
}

const rows: FrameRow[] = readFileSync(ndjsonPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line) as FrameRow)
  .sort((a, b) => a.ordem - b.ordem);

if (rows.length === 0) {
  console.log('NENHUM frame em frames.ndjson.');
  process.exit(1);
}

const stdoutPath = join(cap, 'logs/stdout.log');
const stdoutText = existsSync(stdoutPath) ? readFileSync(stdoutPath, 'utf8') : '';
const bootUriByPid = new Map<number, string>();
for (const m of stdoutText.matchAll(
  /\[SPECULUM-BOOT\] pid=(\d+) ctx=(\d+) uri=(\S+) ops=/g,
)) {
  bootUriByPid.set(Number(m[1]), m[3]);
}

function frameFileName(row: FrameRow): string {
  return `f-${String(row.ordem).padStart(4, '0')}-ctx${row.contextId}-seq${row.sequence}.bin`;
}

function uriForChildPid(childPid: number): string {
  return bootUriByPid.get(childPid) ?? 'uri=?';
}

const tables = new Map<number, ReplicatedTable>();
const persistent = new PersistentStringTable();
let aceitos = 0, recusados = 0;

const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

for (const row of rows) {
  const name = frameFileName(row);
  const path = join(cap, name);
  if (!existsSync(path)) {
    console.log(
      `${name.padEnd(28)} ${String(row.childPid).padEnd(8)} —  —  —  ${uriForChildPid(row.childPid)}  FALHOU arquivo ausente`,
    );
    recusados++;
    continue;
  }
  const bytes = new Uint8Array(readFileSync(path));
  const uri = uriForChildPid(row.childPid);
  const res = decodeFramePart(bytes, persistent);
  if (!res.ok) {
    console.log(
      `${name.padEnd(28)} ${String(row.childPid).padEnd(8)} —  —  —  ${uri}  DECODE FALHOU  ${res.reason}: ${res.message}`,
    );
    recusados++;
    continue;
  }
  const p = res.part;
  const ctxGen = `ctx${p.contextId}/gen${p.generation}`;
  if (!tables.has(row.childPid)) {
    tables.set(row.childPid, new ReplicatedTable());
  }
  const table = tables.get(row.childPid)!;
  const r = applyFrameToTableChecked(table, p.flags?.resync ?? false, p.ops, p.sequence);
  if (r.ok) {
    aceitos++;
    console.log(
      `${name.padEnd(28)} ${String(row.childPid).padEnd(8)} ${ctxGen} seq=${p.sequence} ops=${String(p.ops.length).padStart(4)}  ${uri}  ACEITO`,
    );
  } else {
    recusados++;
    console.log(
      `${name.padEnd(28)} ${String(row.childPid).padEnd(8)} ${ctxGen} seq=${p.sequence} ops=${String(p.ops.length).padStart(4)}  ${uri}  RECUSADO ${j(r)}`,
    );
  }
}

console.log('');
console.log(`${aceitos} aceito(s), ${recusados} recusado(s) de ${rows.length} frame(s)`);
process.exit(recusados === 0 ? 0 : 1);
