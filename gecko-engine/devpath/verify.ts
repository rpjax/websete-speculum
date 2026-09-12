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

const stdoutPath = join(cap, 'logs/stdout.log');
const stdoutText = existsSync(stdoutPath) ? readFileSync(stdoutPath, 'utf8') : '';

const bootUriByPidCtx = new Map<string, string>();
for (const m of stdoutText.matchAll(
  /\[SPECULUM-BOOT\] pid=(\d+) ctx=(\d+) uri=(\S+) ops=/g,
)) {
  bootUriByPidCtx.set(`${m[1]}:${m[2]}`, m[3]);
}

function pidForFrame(contextId: number, sequence: number): number | undefined {
  for (const m of stdoutText.matchAll(
    /\[SPECULUM-FRAME-PART\] pid=(\d+) ctx=(\d+) seq=(\d+)/g,
  )) {
    if (Number(m[2]) === contextId && Number(m[3]) === sequence) {
      return Number(m[1]);
    }
  }
  return undefined;
}

function uriForFrame(contextId: number, sequence: number): string {
  const pid = pidForFrame(contextId, sequence);
  if (pid === undefined) {
    return 'uri=?';
  }
  return bootUriByPidCtx.get(`${pid}:${contextId}`) ?? 'uri=?';
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

const persistent = new PersistentStringTable();
let aceitos = 0, recusados = 0;

const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

for (const name of names) {
  const bytes = new Uint8Array(readFileSync(join(framesDir, name)));
  const res = decodeFramePart(bytes, persistent);
  if (!res.ok) {
    console.log(
      `${name.padEnd(16)} —  —  —  uri=?  DECODE FALHOU  ${res.reason}: ${res.message}`,
    );
    recusados++;
    continue;
  }
  const p = res.part;
  const ctxGen = `ctx${p.contextId}/gen${p.generation}`;
  const uri = uriForFrame(p.contextId, p.sequence);
  const r = applyFrameToTableChecked(
    new ReplicatedTable(),
    p.flags?.resync ?? false,
    p.ops,
    p.sequence,
  );
  if (r.ok) {
    aceitos++;
    console.log(
      `${name.padEnd(16)} ${ctxGen} seq=${p.sequence} ops=${String(p.ops.length).padStart(4)}  ${uri}  ACEITO`,
    );
  } else {
    recusados++;
    console.log(
      `${name.padEnd(16)} ${ctxGen} seq=${p.sequence} ops=${String(p.ops.length).padStart(4)}  ${uri}  RECUSADO ${j(r)}`,
    );
  }
}

console.log('');
console.log(`${aceitos} aceito(s), ${recusados} recusado(s) de ${names.length} frame(s)`);
process.exit(recusados === 0 ? 0 : 1);
