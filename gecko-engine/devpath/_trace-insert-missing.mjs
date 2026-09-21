#!/usr/bin/env node
/**
 * Offline: walk frames, apply table, report first INSERT-id-missing with history of that id.
 */
import { decodeFramePart, FramePartAssembler, PersistentStringTable, peekFrameHeader } from '../../packages/page-projection/dist/core/decode.js';
import { applyFrameToTableChecked } from '../../packages/page-projection/dist/core/replicatedTableApply.js';
import { ReplicatedTable } from '../../packages/page-projection/dist/core/replicatedTable.js';
import { OpCode, NodeKind } from '../../packages/page-projection/dist/core/opcodes.js';
import { CONTEXT_ID_ROOT } from '../../packages/page-projection/dist/core/frame.js';
import fs from 'node:fs';

const dir = process.argv[2];
const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
const table = new ReplicatedTable();
const idBirth = new Map(); // id -> {n, seq, resync, kind, name}

function load(n) {
  return new Uint8Array(fs.readFileSync(`${dir}/f-${String(n).padStart(4, '0')}.bin`));
}

const files = fs.readdirSync(dir).filter((f) => /^f-\d+\.bin$/.test(f)).sort();
console.log('frames on disk', files.length);

for (let n = 1; n <= files.length; n++) {
  const bytes = load(n);
  const hdr = peekFrameHeader(bytes);
  if (hdr && hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  const decoded = decodeFramePart(bytes, strings);
  if (!decoded.ok) {
    console.log('decode fail', n, decoded);
    break;
  }
  const assembled = assembler.ingest(decoded.part);
  if (assembled === null) continue;
  if (typeof assembled === 'string') {
    console.log('assemble fail', n, assembled);
    break;
  }

  for (const op of assembled.ops) {
    if (op.op === OpCode.NodeNew) {
      idBirth.set(op.id, {
        n,
        seq: assembled.sequence,
        resync: assembled.resync,
        kind: op.kind,
        name: op.name,
      });
    }
    if (op.op === OpCode.NodeDrop) {
      for (const id of op.ids) idBirth.delete(id);
    }
  }

  const result = applyFrameToTableChecked(table, assembled.resync, assembled.ops, assembled.sequence);
  if (!result.ok) {
    console.log(
      JSON.stringify(
        {
          failAt: n,
          seq: assembled.sequence,
          resync: assembled.resync,
          reason: result.reason,
          opName: result.opName,
          id: result.id,
          message: result.message,
          failedOpIndex: result.failedOpIndex,
          birth: result.id != null ? idBirth.get(result.id) : null,
          op: assembled.ops[result.failedOpIndex],
          nearby: assembled.ops.slice(Math.max(0, result.failedOpIndex - 3), result.failedOpIndex + 4),
        },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );
    process.exit(1);
  }
}
console.log('all ok', files.length, 'rows', table.size);
