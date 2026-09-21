#!/usr/bin/env node
/**
 * Aferição CSSOM no capture same-S: opcodes no fio + tabela aplicada × dump Virtual.
 * Uso: node gecko-engine/devpath/_analyze-cssom-capture.mjs /tmp/same-s-cssom
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PP = path.join(ROOT, 'packages/page-projection/dist');
const dir = process.argv[2] || '/tmp/same-s-cssom';

const { decodeFramePart, FramePartAssembler, PersistentStringTable, peekFrameHeader } = await import(
  pathToFileURL(path.join(PP, 'core/decode.js')).href
);
const { applyFrameToTableChecked } = await import(
  pathToFileURL(path.join(PP, 'core/replicatedTableApply.js')).href
);
const { ReplicatedTable } = await import(pathToFileURL(path.join(PP, 'core/replicatedTable.js')).href);
const { CONTEXT_ID_ROOT } = await import(pathToFileURL(path.join(PP, 'core/frame.js')).href);
const { OpCode, NodeKind, opCodeName } = await import(
  pathToFileURL(path.join(PP, 'core/opcodes.js')).href
);

const oracle = JSON.parse(fs.readFileSync(path.join(dir, 'oracle.json'), 'utf8'));
const bins = fs
  .readdirSync(dir)
  .filter((f) => /^f-\d+\.bin$/.test(f))
  .sort()
  .map((f) => new Uint8Array(fs.readFileSync(path.join(dir, f))));

const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
const table = new ReplicatedTable();
const opTotals = {};
let lastResync = null;
let lastSeq = null;
let applyFail = null;

for (let i = 0; i < bins.length; i++) {
  const bytes = bins[i];
  const hdr = peekFrameHeader(bytes);
  if (hdr && hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  const decoded = decodeFramePart(bytes, strings);
  if (!decoded.ok) continue;
  const assembled = assembler.ingest(decoded.part);
  if (assembled === null || typeof assembled === 'string') continue;
  for (const op of assembled.ops) {
    const n = opCodeName(op.op);
    opTotals[n] = (opTotals[n] || 0) + 1;
  }
  if (assembled.resync) lastResync = assembled;
  const result = applyFrameToTableChecked(table, assembled.resync, assembled.ops, assembled.sequence);
  if (!result.ok) {
    applyFail ??= { seq: assembled.sequence, ...result };
    break;
  }
  lastSeq = assembled.sequence;
}

function kindCounts(t) {
  const c = {
    Element: 0,
    Text: 0,
    Comment: 0,
    Sheet: 0,
    Rule: 0,
    Doctype: 0,
    ShadowRoot: 0,
    other: 0,
  };
  t.forEachRow((_id, row) => {
    switch (row.kind) {
      case NodeKind.Element:
        c.Element++;
        break;
      case NodeKind.Text:
        c.Text++;
        break;
      case NodeKind.Comment:
        c.Comment++;
        break;
      case NodeKind.Sheet:
        c.Sheet++;
        break;
      case NodeKind.Rule:
        c.Rule++;
        break;
      case NodeKind.Doctype:
        c.Doctype++;
        break;
      case NodeKind.ShadowRoot:
        c.ShadowRoot++;
        break;
      default:
        c.other++;
    }
  });
  return c;
}

const wireKinds = kindCounts(table);
const vHist = oracle.virtual?.dump?.kindHist || {};
const virtualKinds = {
  Element: vHist['1'] || 0,
  Text: vHist['2'] || 0,
  Comment: vHist['3'] || 0,
  Sheet: vHist['4'] || 0,
  Rule: vHist['5'] || 0,
  Doctype: vHist['6'] || 0,
  ShadowRoot: vHist['7'] || 0,
};

const cssomOps = Object.fromEntries(
  Object.entries(opTotals).filter(([k]) => /sheet|rule/i.test(k)),
);

const resyncCssom = lastResync
  ? {
      sheetNew: lastResync.ops.filter((o) => o.op === OpCode.SheetNew).length,
      ruleNew: lastResync.ops.filter((o) => o.op === OpCode.RuleNew).length,
      sheetOrder: lastResync.ops.filter((o) => o.op === OpCode.SheetOrder).length,
    }
  : null;

// Sample rule texts that Chrome Projected often rejects
const ruleSamples = [];
const suspects = [];
if (lastResync) {
  for (const o of lastResync.ops) {
    if (o.op !== OpCode.RuleNew) continue;
    const t = o.text || '';
    if (ruleSamples.length < 5) ruleSamples.push(t.slice(0, 120));
    if (
      /@(import|charset|namespace)\b/i.test(t) ||
      /^-moz-/m.test(t) ||
      /behavior\s*:/i.test(t) ||
      /expression\s*\(/i.test(t) ||
      t.trim() === ''
    ) {
      suspects.push(t.slice(0, 160));
    }
  }
}

const out = {
  frames: bins.length,
  lastSeq,
  applyFail,
  cssomOpsAllFrames: cssomOps,
  resyncCssom,
  virtualKindsAtDumpSeq: {
    seq: oracle.virtual?.dump?.sequence,
    ...virtualKinds,
    rowCount: oracle.virtual?.dump?.rowCount,
  },
  wireKindsAtEndSeq: { seq: lastSeq, ...wireKinds, rowCount: table.size },
  kindDeltaVirtualDumpVsWireEnd: {
    Element: wireKinds.Element - virtualKinds.Element,
    Sheet: wireKinds.Sheet - virtualKinds.Sheet,
    Rule: wireKinds.Rule - virtualKinds.Rule,
    Text: wireKinds.Text - virtualKinds.Text,
  },
  note:
    'Dump Virtual e wire-end em seq diferentes → delta de kind não é iso same-S. Compare Sheet/Rule counts e cssomOps.',
  ruleSamples,
  suspectRuleTexts: { count: suspects.length, sample: suspects.slice(0, 10) },
  projectedHud: oracle.projectedDom?.hud,
  projectedPixels: oracle.projectedPixels,
  verdict: oracle.verdict,
};

fs.writeFileSync(path.join(dir, 'cssom-analyze.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
