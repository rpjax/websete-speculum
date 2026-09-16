#!/usr/bin/env node
/**
 * Oráculo same-S oficial (Gecko lab) — status quo de debug de layout/CSSOM/DOM/asset.
 *
 * Contrato: Halt → Flush → Snapshot Virtual + requestSnapshot Projected (CSSOM + layout)
 * via `client.sameS` → `lab.sameSResult`. Não declara PASS por HUD.
 *
 * Uso:
 *   node gecko-engine/devpath/lab-same-s-oracle.mjs [url]
 *   WAIT_MS=45000 OUT_DIR=/tmp/same-s node … 
 *
 * Ver: docs/gecko-engine/lab-debug-surface.md §Same-S
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PP = path.join(ROOT, 'packages/page-projection/dist');

const { decodeFramePart, FramePartAssembler, PersistentStringTable, peekFrameHeader } = await import(
  pathToFileURL(path.join(PP, 'core/decode.js')).href
);
const { applyFrameToTableChecked } = await import(
  pathToFileURL(path.join(PP, 'core/replicatedTableApply.js')).href
);
const { ReplicatedTable } = await import(pathToFileURL(path.join(PP, 'core/replicatedTable.js')).href);
const { CONTEXT_ID_ROOT } = await import(pathToFileURL(path.join(PP, 'core/frame.js')).href);
const { NodeKind } = await import(pathToFileURL(path.join(PP, 'core/opcodes.js')).href);

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 40000);
const OUT = process.env.OUT_DIR || path.join(ROOT, 'gecko-engine/devpath/captures', `same-s-${Date.now()}`);
fs.mkdirSync(OUT, { recursive: true });

function u32(buf, o) {
  return buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24);
}
function u64(buf, o) {
  const lo = BigInt(u32(buf, o) >>> 0);
  const hi = BigInt(u32(buf, o + 4) >>> 0);
  return (hi << 32n) | lo;
}

function parseVirtualDump(bytes) {
  if (!bytes || bytes.length < 28) return { ok: false, reason: 'short' };
  let o = 0;
  const sequence = u32(bytes, o); o += 4;
  const generation = u32(bytes, o); o += 4;
  const contextId = u32(bytes, o); o += 4;
  const tableHash = u64(bytes, o); o += 8;
  const rowCount = u32(bytes, o); o += 4;
  const lastFrameNewNodes = u32(bytes, o); o += 4;
  const kindHist = {};
  for (let i = 0; i < rowCount && o + 20 <= bytes.length; i++) {
    o += 4; // id
    const kind = u32(bytes, o); o += 4;
    o += 4; // parent
    o += 8; // rowHash
    kindHist[kind] = (kindHist[kind] || 0) + 1;
  }
  return {
    ok: true,
    sequence,
    generation,
    contextId,
    tableHash: tableHash.toString(),
    rowCount,
    lastFrameNewNodes,
    kindHist,
    kinds: {
      Element: kindHist[NodeKind.Element] || 0,
      Text: kindHist[NodeKind.Text] || 0,
      Comment: kindHist[NodeKind.Comment] || 0,
      Sheet: kindHist[NodeKind.Sheet] || 0,
      Rule: kindHist[NodeKind.Rule] || 0,
      Doctype: kindHist[NodeKind.Doctype] || 0,
      ShadowRoot: kindHist[NodeKind.ShadowRoot] || 0,
    },
  };
}

function sha16(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function classify(sameS, layout, wireKinds) {
  const reasons = [];
  const hypotheses = [];

  if (!sameS?.ok) {
    reasons.push(`same_s_transport:${sameS?.error || 'incomplete'}`);
  }
  if (sameS?.sameSequence === false) {
    reasons.push('sequence_mismatch_after_halt_flush');
  }

  const geoBroken =
    layout &&
    ((layout.overlapPairsAmong40 ?? 0) > 80 ||
      (layout.samples || []).some(
        (s) => s.sel === 'header' && s.rect && s.rect.h > 200,
      ));

  const assetsBroken = (layout?.brokenImgs ?? 0) >= 5;
  const dual = layout?.dualHint?.duplicateAuthorRules === true;

  const vRules = wireKinds?.Rule ?? sameS?.virtualKinds?.Rule ?? null;
  const pAdopted = layout?.adoptedRules ?? null;
  const pDoc = layout?.docSheetRules ?? null;

  // H6 needs Virtual paint — not in this capture; marked unknown.
  hypotheses.push({ id: 'H6_virtual_also_broken', status: 'unknown', note: 'precisa clip Virtual headed' });

  if (geoBroken && assetsBroken) {
    hypotheses.push({
      id: 'H5_asset',
      status: 'suspect',
      note: `brokenImgs=${layout.brokenImgs}; geometria também falha`,
    });
  } else if (assetsBroken) {
    hypotheses.push({ id: 'H5_asset', status: 'suspect', note: `brokenImgs=${layout.brokenImgs}` });
  } else {
    hypotheses.push({ id: 'H5_asset', status: 'unlikely', note: 'poucas imgs mortas no sample' });
  }

  if (dual) {
    hypotheses.push({
      id: 'H4_dual_materialize',
      status: 'suspect',
      note: `docSheetRules=${pDoc} adoptedRules=${pAdopted}`,
    });
  } else {
    hypotheses.push({ id: 'H4_dual_materialize', status: 'unlikely' });
  }

  if (vRules != null && pAdopted != null && Math.abs(vRules - pAdopted) > Math.max(50, vRules * 0.05)) {
    hypotheses.push({
      id: 'H3_cssom_content_or_count',
      status: 'suspect',
      note: `virtualRules=${vRules} projectedAdopted=${pAdopted}`,
    });
  } else {
    hypotheses.push({
      id: 'H3_cssom_content_or_count',
      status: 'unlikely_count',
      note: 'contagem próxima — ainda pode divergir texto/ordem (ver cssomSheetDump)',
    });
  }

  // DOM/ATTR: need tree/attr diff Virtual×Projected — dump gives kinds only.
  hypotheses.push({
    id: 'H1_dom_structure',
    status: 'needs_tree_diff',
    note: 'projected.tree presente; Virtual tree ainda não no dump C++ — comparar kinds + projected.tree size',
  });
  hypotheses.push({
    id: 'H2_attr',
    status: assetsBroken ? 'suspect_via_img' : 'needs_attr_diff',
    note: assetsBroken ? 'src/srcset suspeitos no layoutProbe.imgsSample' : 'comparar class/src no próximo passo',
  });

  if (geoBroken) reasons.push('projected_geometry_broken');
  if (assetsBroken) reasons.push('projected_assets_broken');

  const primary =
    hypotheses.find((h) => h.status === 'suspect')?.id ||
    (geoBroken ? 'geometry_broken_cause_unlocated' : 'no_strong_suspect');

  return {
    primary,
    reasons,
    hypotheses,
    oneLiner: `${primary} | ${reasons.join(' | ') || 'no_flags'}`,
  };
}

const bins = [];
let sameSResult = null;
let navigated = [];

const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.webSocketFrameReceived', (params) => {
  const payload = params.response?.payloadData;
  if (!payload) return;
  if (params.response?.opcode === 2) {
    const raw = Buffer.from(payload, 'base64');
    const n = bins.length + 1;
    fs.writeFileSync(path.join(OUT, `f-${String(n).padStart(4, '0')}.bin`), raw);
    bins.push(new Uint8Array(raw));
    return;
  }
  if (params.response?.opcode !== 1) return;
  let msg;
  try {
    msg = JSON.parse(payload);
  } catch {
    return;
  }
  if (msg.type === 'gecko.navigated') navigated.push(msg.url || '');
  if (msg.type === 'lab.sameSResult') {
    sameSResult = msg;
    fs.writeFileSync(path.join(OUT, 'same-s-result.json'), JSON.stringify(msg, null, 2));
  }
});

await page.goto(`${LAB}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('#connect');
await page.waitForFunction(() => !(document.getElementById('browseStart')?.disabled ?? true), null, {
  timeout: 90000,
});
await page.waitForTimeout(400);
await page.evaluate((url) => {
  const u = document.getElementById('url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, URL);
await page.click('button:has-text("Start Virtual")');
await page.waitForTimeout(WAIT_MS);

// Ativa same-S oficial (botão Snapshot no Gecko = client.sameS)
await page.locator('#browseSnap').evaluate((el) => el.click());
const deadline = Date.now() + 20000;
while (!sameSResult && Date.now() < deadline) {
  await page.waitForTimeout(250);
}

let projectedPng = null;
try {
  const handle = await page.$('[data-pp-surface-stage] iframe, #surface iframe, iframe');
  if (handle) {
    const shot = await handle.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(OUT, 'projected-surface.png'), shot);
    projectedPng = path.join(OUT, 'projected-surface.png');
  }
} catch {
  /* ignore */
}

await browser.close();

// Wire table at end (contexto; same-S usa dump Virtual)
const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
const table = new ReplicatedTable();
let lastSeq = null;
for (const bytes of bins) {
  const hdr = peekFrameHeader(bytes);
  if (hdr && hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  const decoded = decodeFramePart(bytes, strings);
  if (!decoded.ok) continue;
  const assembled = assembler.ingest(decoded.part);
  if (!assembled || typeof assembled === 'string') continue;
  const result = applyFrameToTableChecked(table, assembled.resync, assembled.ops, assembled.sequence);
  if (!result.ok) break;
  lastSeq = assembled.sequence;
}
const wireKinds = { Element: 0, Text: 0, Sheet: 0, Rule: 0, Comment: 0, Doctype: 0, ShadowRoot: 0 };
table.forEachRow((_id, row) => {
  switch (row.kind) {
    case NodeKind.Element: wireKinds.Element++; break;
    case NodeKind.Text: wireKinds.Text++; break;
    case NodeKind.Sheet: wireKinds.Sheet++; break;
    case NodeKind.Rule: wireKinds.Rule++; break;
    case NodeKind.Comment: wireKinds.Comment++; break;
    case NodeKind.Doctype: wireKinds.Doctype++; break;
    case NodeKind.ShadowRoot: wireKinds.ShadowRoot++; break;
  }
});

const dumpBytes = sameSResult?.virtual?.dumpBytes
  ? Buffer.from(sameSResult.virtual.dumpBytes, 'base64')
  : null;
const virtualDump = dumpBytes ? parseVirtualDump(dumpBytes) : null;
if (dumpBytes) fs.writeFileSync(path.join(OUT, 'virtual-dump.bin'), dumpBytes);

const layout = sameSResult?.projected?.layoutProbe ?? null;
const cssomDump = sameSResult?.projected?.cssomSheetDump ?? null;
const projectedTable = sameSResult?.projected?.table ?? null;

const cssomTextHash = cssomDump?.entries
  ? sha16(
      JSON.stringify(
        (cssomDump.entries || []).map((e) => ({
          adopted: e.adopted,
          href: e.href,
          n: e.ruleCount,
          rules: Array.isArray(e.rules) ? e.rules.slice(0, 20) : e.rules,
        })),
      ),
    )
  : null;

const verdict = classify(
  {
    ...sameSResult,
    virtualKinds: virtualDump?.kinds,
  },
  layout,
  wireKinds,
);

const report = {
  url: URL,
  waitMs: WAIT_MS,
  outDir: OUT,
  protocol: 'client.sameS → lab.sameSResult (Halt/Flush/Snapshot)',
  navigated,
  sameS: {
    ok: sameSResult?.ok ?? false,
    error: sameSResult?.error ?? (sameSResult ? null : 'no_lab_sameSResult'),
    sameSequence: sameSResult?.sameSequence ?? null,
    virtualSequence: sameSResult?.virtualSequence ?? null,
    projectedSequence: sameSResult?.projectedSequence ?? null,
    virtualTableHash: sameSResult?.virtualTableHash ?? null,
    projectedTableHash: sameSResult?.projectedTableHash ?? null,
  },
  virtualDump,
  wire: { frameCount: bins.length, lastSeq, rowCount: table.size, kinds: wireKinds },
  projected: {
    table: projectedTable,
    layout,
    cssomSheetDumpSummary: cssomDump
      ? {
          ok: cssomDump.ok,
          totalRules: cssomDump.totalRules,
          styleSheetCount: cssomDump.styleSheetCount,
          adoptedCount: cssomDump.adoptedCount,
          textHash16: cssomTextHash,
        }
      : null,
    armed: sameSResult?.projected?.armed ?? null,
    desynced: sameSResult?.projected?.desynced ?? null,
    treePresent: !!sameSResult?.projected?.tree,
  },
  projectedPng,
  verdict,
};

fs.writeFileSync(path.join(OUT, 'oracle.json'), JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.error(`wrote ${OUT}/oracle.json`);
process.exit(sameSResult?.ok && verdict.primary !== 'geometry_broken_cause_unlocated' ? 0 : 2);
