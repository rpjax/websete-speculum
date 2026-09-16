#!/usr/bin/env node
/**
 * Isonomia same-S Virtual × Projected (DOM tabela + CSSOM).
 * Um ato: Halt/Flush/Snapshot → compara dump Virtual, fio aplicado e Projected.
 * Não declara PASS por HUD / 200 / armed.
 *
 * Uso:
 *   node gecko-engine/devpath/lab-same-s-iso.mjs [url]
 *   WAIT_MS=45000 OUT_DIR=... node …
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
const { applyFrameToTable } = await import(
  pathToFileURL(path.join(PP, 'core/replicatedTableApply.js')).href
);
const { ReplicatedTable } = await import(pathToFileURL(path.join(PP, 'core/replicatedTable.js')).href);
const { CONTEXT_ID_ROOT } = await import(pathToFileURL(path.join(PP, 'core/frame.js')).href);
const { NodeKind, OpCode } = await import(pathToFileURL(path.join(PP, 'core/opcodes.js')).href);

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 45000);
const OUT = process.env.OUT_DIR || path.join(ROOT, 'gecko-engine/devpath/captures', `same-s-iso-${Date.now()}`);
fs.mkdirSync(OUT, { recursive: true });

function u32(buf, o) {
  return buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24);
}
function u64(buf, o) {
  const lo = BigInt(u32(buf, o) >>> 0);
  const hi = BigInt(u32(buf, o + 4) >>> 0);
  return (hi << 32n) | lo;
}
function sha16(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function emptyKinds() {
  return { Element: 0, Text: 0, Comment: 0, Sheet: 0, Rule: 0, Doctype: 0, ShadowRoot: 0 };
}

function kindName(k) {
  switch (k) {
    case NodeKind.Element: return 'Element';
    case NodeKind.Text: return 'Text';
    case NodeKind.Comment: return 'Comment';
    case NodeKind.Sheet: return 'Sheet';
    case NodeKind.Rule: return 'Rule';
    case NodeKind.Doctype: return 'Doctype';
    case NodeKind.ShadowRoot: return 'ShadowRoot';
    default: return `k${k}`;
  }
}

/** Dump C++: sequence + rows {id,kind,parent,rowHash} — value só em Leaf via table JS. */
function parseVirtualDump(bytes) {
  if (!bytes || bytes.length < 28) return { ok: false, reason: 'short' };
  let o = 0;
  const sequence = u32(bytes, o); o += 4;
  const generation = u32(bytes, o); o += 4;
  const contextId = u32(bytes, o); o += 4;
  const tableHash = u64(bytes, o); o += 8;
  const rowCount = u32(bytes, o); o += 4;
  const lastFrameNewNodes = u32(bytes, o); o += 4;
  const kinds = emptyKinds();
  const rows = [];
  for (let i = 0; i < rowCount && o + 20 <= bytes.length; i++) {
    const id = u32(bytes, o); o += 4;
    const kind = u32(bytes, o); o += 4;
    const parent = u32(bytes, o); o += 4;
    const rowHash = u64(bytes, o); o += 8;
    const name = kindName(kind);
    if (name in kinds) kinds[name]++;
    rows.push({ id, kind, parent, rowHash: rowHash.toString() });
  }
  return {
    ok: true,
    sequence,
    generation,
    contextId,
    tableHash: tableHash.toString(),
    rowCount,
    lastFrameNewNodes,
    kinds,
    rows,
  };
}

const K5_CSP = "script-src 'none'; object-src 'none'";
const PARITY_RULE_MARK = 'noscript{display:none';

function tableKinds(table) {
  const kinds = emptyKinds();
  table.forEachRow((_id, row) => {
    const name = kindName(row.kind);
    if (name in kinds) kinds[name]++;
  });
  return { rowCount: table.size, kinds };
}

/** Rule texts live only on the wire ops — ReplicatedTable stores hash, not value. */
function trackWireRuleTexts(ops, ruleById) {
  for (const op of ops) {
    if (op.op === OpCode.RuleNew || op.op === OpCode.RuleSet) {
      ruleById.set(op.id, { text: op.text, sheet: op.sheet ?? ruleById.get(op.id)?.sheet ?? 0 });
    } else if (op.op === OpCode.RuleDrop) {
      for (const id of op.ids || []) ruleById.delete(id);
    } else if (op.op === OpCode.SheetDrop) {
      const dropped = new Set(op.ids || []);
      for (const [id, meta] of ruleById) {
        if (dropped.has(meta.sheet)) ruleById.delete(id);
      }
    }
  }
}

function normCssText(t) {
  return String(t).replace(/\s+/g, ' ').trim();
}

function wireRuleDigest(ruleById) {
  const ruleTexts = [...ruleById.values()]
    .map((m) => (typeof m === 'string' ? m : m?.text))
    .filter((t) => typeof t === 'string')
    .map(normCssText);
  ruleTexts.sort();
  return {
    ruleCount: ruleTexts.length,
    ruleTextHash16: sha16(ruleTexts.join('\n')),
    ruleTextSample: ruleTexts.slice(0, 5).map((t) => t.slice(0, 100)),
  };
}

function attrMap(node) {
  const m = new Map();
  if (!node?.attrs || !Array.isArray(node.attrs)) return m;
  for (const pair of node.attrs) {
    if (Array.isArray(pair) && pair.length >= 2) m.set(String(pair[0]), String(pair[1]));
  }
  return m;
}

/** Speculum infra nodes — not site DOM; exclude from tree vs wire Element compare. */
function isSpeculumInfraElement(node) {
  if (!node || typeof node.tag !== 'string') return false;
  const tag = node.tag;
  if (tag.startsWith('#')) return false;
  const attrs = attrMap(node);
  if (attrs.has('data-speculum-document-base')) return true;
  if (attrs.has('data-speculum-scripting-on-paint-parity')) return true;
  for (const name of attrs.keys()) {
    if (name.startsWith('data-speculum-')) return true;
  }
  if (tag === 'meta') {
    const content = attrs.get('content') || '';
    if (content === K5_CSP || content.includes("script-src 'none'")) return true;
  }
  return false;
}

function walkProjectedTree(node, acc, opts = {}) {
  if (!node || typeof node !== 'object') return;
  const filterInfra = opts.filterInfra === true;
  const tag = node.tag;
  if (tag === '#text') {
    acc.Text++;
    return;
  }
  if (tag === '#comment') {
    acc.Comment++;
    return;
  }
  if (tag === '#doctype' || tag === '!doctype') {
    acc.Doctype++;
    // Doctype is NodeKind.Doctype on the wire — not Element
    const kids = node.children;
    if (Array.isArray(kids)) {
      for (const ch of kids) {
        if (typeof ch === 'string') acc.Text++;
        else walkProjectedTree(ch, acc, opts);
      }
    }
    return;
  }
  if (tag === '#document' || tag === '#shadow-root') {
    /* container — not an Element row */
  } else if (typeof tag === 'string') {
    if (filterInfra && isSpeculumInfraElement(node)) {
      acc.infraSkipped = (acc.infraSkipped || 0) + 1;
      return;
    }
    acc.Element++;
  }
  const kids = node.children;
  if (Array.isArray(kids)) {
    for (const ch of kids) {
      if (typeof ch === 'string') acc.Text++;
      else walkProjectedTree(ch, acc, opts);
    }
  }
  if (node.shadow) walkProjectedTree(node.shadow, acc, opts);
  if (node.nested) walkProjectedTree(node.nested, acc, opts);
}

function collectAttrSamples(node, out, opts = {}) {
  if (!node || typeof node !== 'object') return;
  const tag = node.tag;
  if (typeof tag === 'string' && !tag.startsWith('#')) {
    if (!(opts.filterInfra && isSpeculumInfraElement(node))) {
      const attrs = attrMap(node);
      if (tag === 'img') {
        out.imgs.push({
          src: attrs.get('src') || '',
          srcset: attrs.get('srcset') || '',
          class: attrs.get('class') || '',
        });
      }
      if (tag === 'a') {
        out.anchors.push({
          href: attrs.get('href') || '',
          class: attrs.get('class') || '',
        });
      }
      if (attrs.has('class') && out.classes.length < 40) {
        out.classes.push({ tag, class: attrs.get('class') || '' });
      }
    }
  }
  const kids = node.children;
  if (Array.isArray(kids)) {
    for (const ch of kids) {
      if (typeof ch === 'object') collectAttrSamples(ch, out, opts);
    }
  }
  if (node.shadow) collectAttrSamples(node.shadow, out, opts);
  if (node.nested) collectAttrSamples(node.nested, out, opts);
}

function isTruncatedAssetSrc(src) {
  if (!src) return true;
  // bare extension / fragment like "f_avif" or empty path segment as sole "filename"
  const base = src.split('?')[0].split('#')[0];
  const leaf = base.split('/').pop() || '';
  if (!leaf) return true;
  if (/^f_(avif|webp|jpg|jpeg|png)$/i.test(leaf)) return true;
  if (/^\.[a-z0-9]+$/i.test(leaf)) return true;
  return false;
}

function projectedAdoptedRuleDigest(cssomDump) {
  if (!cssomDump || cssomDump.ok !== true) {
    return { ok: false, reason: cssomDump?.reason || 'missing', ruleCount: 0, ruleTextHash16: null, paritySkipped: 0 };
  }
  const texts = [];
  let paritySkipped = 0;
  for (const e of cssomDump.entries || []) {
    if (!e.adopted) continue;
    if (!Array.isArray(e.rules)) continue;
    for (const t of e.rules) {
      const s = String(t);
      // client paint-parity constructable sheet
      if (s.replace(/\s+/g, '').toLowerCase().includes(PARITY_RULE_MARK.toLowerCase())) {
        paritySkipped++;
        continue;
      }
      texts.push(normCssText(s));
    }
  }
  texts.sort();
  return {
    ok: true,
    ruleCount: texts.length,
    ruleTextHash16: sha16(texts.join('\n')),
    ruleTextSample: texts.slice(0, 5).map((t) => t.slice(0, 100)),
    paritySkipped,
  };
}

function projectedCssomFromLayout(layout) {
  const sheets = layout?.sheets || [];
  let docRules = 0;
  let adoptedRules = 0;
  const adoptedTexts = [];
  const docTexts = [];
  for (const s of sheets) {
    const n = s.ruleCount ?? 0;
    if (s.origin === 'document.adoptedStyleSheets') {
      adoptedRules += n;
      for (const t of s.ruleTextSample || []) adoptedTexts.push(t);
    } else {
      docRules += n;
      for (const t of s.ruleTextSample || []) docTexts.push(t);
    }
  }
  return {
    docSheetCount: layout?.docSheetCount ?? null,
    adoptedSheetCount: layout?.adoptedSheetCount ?? null,
    docRules,
    adoptedRules,
    totalPaintRules: docRules + adoptedRules,
    duplicateAuthorRules: layout?.dualHint?.duplicateAuthorRules === true,
    sampleOverlap: [...docTexts].filter((t) => adoptedTexts.includes(t)).length,
  };
}

function diffKinds(a, b, labelA, labelB) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const deltas = {};
  let equal = true;
  for (const k of keys) {
    const va = a?.[k] ?? 0;
    const vb = b?.[k] ?? 0;
    if (va !== vb) {
      equal = false;
      deltas[k] = { [labelA]: va, [labelB]: vb, d: vb - va };
    }
  }
  return { equal, deltas };
}

// --- capture same-S ---
const bins = [];
let sameSResult = null;
let navigated = [];

const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const assetConsole = [];
page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('[gecko-asset]')) assetConsole.push(t);
});
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
    fs.writeFileSync(path.join(OUT, 'same-s-result.json'), JSON.stringify(msg));
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
await page.locator('#browseSnap').evaluate((el) => el.click());
const deadline = Date.now() + 25000;
while (!sameSResult && Date.now() < deadline) {
  await page.waitForTimeout(250);
}

// Diagnóstico de ativo no Projected (após same-S) — decode no iframe vs parent.
let assetDiag = null;
try {
  assetDiag = await page.evaluate(async () => {
    const iframe = document.querySelector('#surface iframe, iframe');
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow;
    if (!doc || !win) return { ok: false, reason: 'no_iframe_doc' };
    const logo = [...doc.images].find((i) => /logo\.svg/i.test(i.currentSrc || i.src || ''));
    if (!logo) return { ok: false, reason: 'no_logo_img', imgCount: doc.images.length };
    const src = logo.currentSrc || logo.src;
    const csp = [...doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map(
      (m) => m.getAttribute('content'),
    );
    let fetchInIframe = null;
    let blobInIframe = null;
    try {
      const res = await win.fetch(src, { credentials: 'omit' });
      const buf = await res.arrayBuffer();
      fetchInIframe = {
        status: res.status,
        contentType: res.headers.get('content-type'),
        byteLength: buf.byteLength,
        head: new TextDecoder().decode(buf.slice(0, 80)),
      };
      const blob = new Blob([buf], { type: res.headers.get('content-type') || 'image/svg+xml' });
      const url = win.URL.createObjectURL(blob);
      const im = new win.Image();
      await new Promise((resolve, reject) => {
        im.onload = () => resolve(null);
        im.onerror = () => reject(new Error('iframe_blob_error'));
        im.src = url;
      });
      blobInIframe = { naturalWidth: im.naturalWidth, naturalHeight: im.naturalHeight };
      win.URL.revokeObjectURL(url);
    } catch (e) {
      fetchInIframe = { error: e instanceof Error ? e.message : String(e) };
    }
    return {
      ok: true,
      src: src.slice(0, 160),
      complete: logo.complete,
      naturalWidth: logo.naturalWidth,
      naturalHeight: logo.naturalHeight,
      csp,
      fetchInIframe,
      blobInIframe,
      swController: !!(win.navigator.serviceWorker && win.navigator.serviceWorker.controller),
      cacheBustReload: await (async () => {
        const bust = src + (src.includes('?') ? '&' : '?') + 'speculum_cb=' + Date.now();
        logo.src = bust;
        await new Promise((r) => setTimeout(r, 800));
        return { complete: logo.complete, naturalWidth: logo.naturalWidth, naturalHeight: logo.naturalHeight, bustSrc: logo.currentSrc.slice(0, 180) };
      })(),
      blobAsImgSrc: await (async () => {
        try {
          const res = await win.fetch(src, { credentials: 'omit' });
          const buf = await res.arrayBuffer();
          const blob = new Blob([buf], { type: 'image/svg+xml' });
          const url = win.URL.createObjectURL(blob);
          logo.src = url;
          await new Promise((r) => setTimeout(r, 500));
          const out = { complete: logo.complete, naturalWidth: logo.naturalWidth, naturalHeight: logo.naturalHeight };
          return out;
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      })(),
    };
  });
} catch (e) {
  assetDiag = { ok: false, reason: e instanceof Error ? e.message : String(e) };
}
await browser.close();

if (!sameSResult) {
  const fail = { ok: false, error: 'no_lab_sameSResult', outDir: OUT };
  fs.writeFileSync(path.join(OUT, 'iso.json'), JSON.stringify(fail, null, 2));
  console.log(JSON.stringify(fail, null, 2));
  process.exit(2);
}

// Wire table — latest root generation only; unchecked apply (CDP capture is not the live client).
const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
const table = new ReplicatedTable();
const wireRulesById = new Map();
let lastSeq = null;
let applyBreak = null;
const rootGens = [];
for (const bytes of bins) {
  const hdr = peekFrameHeader(bytes);
  if (!hdr) continue;
  if (hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  rootGens.push(hdr.generation);
}
const targetGen = rootGens.length ? rootGens[rootGens.length - 1] : null;
let firstOfGen = true;
for (const bytes of bins) {
  const hdr = peekFrameHeader(bytes);
  if (!hdr) continue;
  if (hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  if (targetGen != null && hdr.generation !== targetGen) continue;
  const decoded = decodeFramePart(bytes, strings);
  if (!decoded.ok) continue;
  const assembled = assembler.ingest(decoded.part);
  if (!assembled || typeof assembled === 'string') continue;
  const forceResync = firstOfGen || assembled.resync;
  firstOfGen = false;
  if (forceResync) wireRulesById.clear();
  trackWireRuleTexts(assembled.ops, wireRulesById);
  try {
    applyFrameToTable(table, forceResync, assembled.ops, assembled.sequence);
    lastSeq = assembled.sequence;
  } catch (err) {
    applyBreak = {
      seq: assembled.sequence,
      gen: assembled.generation,
      error: err instanceof Error ? err.message : String(err),
    };
    break;
  }
}

const dumpBytes = sameSResult?.virtual?.dumpBytes
  ? Buffer.from(sameSResult.virtual.dumpBytes, 'base64')
  : null;
if (dumpBytes) fs.writeFileSync(path.join(OUT, 'virtual-dump.bin'), dumpBytes);
const virtualDump = dumpBytes ? parseVirtualDump(dumpBytes) : { ok: false, reason: 'no_dump' };
const wireKinds = tableKinds(table);
const wireRules = wireRuleDigest(wireRulesById);
const wire = { ...wireKinds, ...wireRules };

const projected = sameSResult.projected || {};
const layout = projected.layoutProbe || null;
const cssomDump = projected.cssomSheetDump || null;
const projectedTable = projected.table || null;
const tree = projected.tree || null;
const treeKindsRaw = emptyKinds();
if (tree) walkProjectedTree(tree, treeKindsRaw, { filterInfra: false });
const treeKinds = emptyKinds();
treeKinds.infraSkipped = 0;
if (tree) walkProjectedTree(tree, treeKinds, { filterInfra: true });

const attrSamples = { imgs: [], anchors: [], classes: [] };
if (tree) collectAttrSamples(tree, attrSamples, { filterInfra: true });

const cssomLive = projectedCssomFromLayout(layout);
const adoptedDigest = projectedAdoptedRuleDigest(cssomDump);

// --- asserts ---
const checks = [];

function check(id, pass, detail) {
  checks.push({ id, pass: !!pass, detail });
}

check(
  'sameS_transport',
  sameSResult.ok === true,
  { error: sameSResult.error ?? null },
);
check(
  'same_sequence',
  sameSResult.sameSequence === true,
  {
    virtualSequence: sameSResult.virtualSequence,
    projectedSequence: sameSResult.projectedSequence,
  },
);
check('wire_apply_complete', !applyBreak && table.size > 0, applyBreak ?? { rowCount: table.size });
check('projected_armed', projected.armed === true, { armed: projected.armed });
check('projected_synced', projected.desynced !== true, { desynced: projected.desynced });

// DOM tabela: Virtual dump × fio × Projected digest
const vKinds = virtualDump.kinds || emptyKinds();
const dumpVsWire = diffKinds(vKinds, wire.kinds, 'virtualDump', 'wire');
check('dom_table_kinds_virtual_vs_wire', dumpVsWire.equal, dumpVsWire.deltas);

const rowDumpWire =
  virtualDump.ok && virtualDump.rowCount === wire.rowCount;
check('dom_table_rowCount_virtual_vs_wire', rowDumpWire, {
  virtualDump: virtualDump.rowCount,
  wire: wire.rowCount,
});

const projRows = projectedTable?.rowCount ?? null;
check('dom_table_rowCount_wire_vs_projected', projRows === wire.rowCount, {
  wire: wire.rowCount,
  projected: projRows,
});

// Árvore Projected filtrada × Element/Text do fio
const treeVsWireDom = {
  Element: { treeFiltered: treeKinds.Element, wire: wire.kinds.Element, treeRaw: treeKindsRaw.Element },
  Text: { treeFiltered: treeKinds.Text, wire: wire.kinds.Text, treeRaw: treeKindsRaw.Text },
  infraSkipped: treeKinds.infraSkipped || 0,
};
const treeDomOk =
  !!tree &&
  treeKinds.Element === wire.kinds.Element &&
  treeKinds.Text === wire.kinds.Text;
check('dom_tree_filtered_vs_wire_element_text', treeDomOk, treeVsWireDom);

// CSSOM: plano Gecko = Sheet/Rule na tabela = adopted no Projected (style fica no DOM)
check(
  'cssom_wire_rule_count_vs_projected_adopted',
  wire.kinds.Rule === cssomLive.adoptedRules ||
    wire.kinds.Rule + 1 === cssomLive.adoptedRules ||
    Math.abs(wire.kinds.Rule - cssomLive.adoptedRules) <= 1,
  {
    wireRules: wire.kinds.Rule,
    projectedAdoptedRules: cssomLive.adoptedRules,
    wireSheets: wire.kinds.Sheet,
    projectedAdoptedSheets: cssomLive.adoptedSheetCount,
  },
);

check(
  'cssom_no_duplicate_author_rules',
  cssomLive.duplicateAuthorRules !== true,
  {
    duplicateAuthorRules: cssomLive.duplicateAuthorRules,
    sampleOverlap: cssomLive.sampleOverlap,
    docRules: cssomLive.docRules,
    adoptedRules: cssomLive.adoptedRules,
  },
);

// Dump CSSOM completo
check('cssom_sheet_dump_ok', cssomDump?.ok === true, {
  ok: cssomDump?.ok ?? false,
  reason: cssomDump?.reason ?? 'missing',
  totalRules: cssomDump?.totalRules ?? 0,
  styleSheetCount: cssomDump?.styleSheetCount ?? 0,
  adoptedCount: cssomDump?.adoptedCount ?? 0,
});

// Rule text hash: fio × adopted dump (parity noscript excluído)
const ruleTextOk =
  adoptedDigest.ok === true &&
  wireRules.ruleCount > 0 &&
  adoptedDigest.ruleCount === wireRules.ruleCount &&
  adoptedDigest.ruleTextHash16 === wireRules.ruleTextHash16;
check('cssom_rule_text_hash_wire_vs_adopted', ruleTextOk, {
  wire: {
    ruleCount: wireRules.ruleCount,
    hash16: wireRules.ruleTextHash16,
    sample: wireRules.ruleTextSample,
  },
  adopted: {
    ok: adoptedDigest.ok,
    reason: adoptedDigest.reason,
    ruleCount: adoptedDigest.ruleCount,
    hash16: adoptedDigest.ruleTextHash16,
    paritySkipped: adoptedDigest.paritySkipped,
    sample: adoptedDigest.ruleTextSample,
  },
});

// Attrs sample — fail on truncated / empty logo src
const logoAttrs = attrSamples.imgs.filter((i) => /logo\.svg/i.test(i.src) || /logo/i.test(i.class));
const truncatedImgs = attrSamples.imgs.filter((i) => i.src && isTruncatedAssetSrc(i.src));
const emptyLogo = logoAttrs.some((i) => !i.src || i.src.length < 8);
check('attrs_img_src_sane', truncatedImgs.length === 0 && !emptyLogo, {
  imgSampleCount: attrSamples.imgs.length,
  logoAttrs: logoAttrs.slice(0, 5),
  truncatedSample: truncatedImgs.slice(0, 5),
  emptyLogo,
  anchorSample: attrSamples.anchors.slice(0, 3),
});

// Ativo — logo complete + nw>0; header height sane; brokenImgs = complete∩nw0
const imgsSample = layout?.imgsSample || [];
const logoLive = imgsSample.find((i) => /logo\.svg/i.test(i.src || ''));
const headerSample = (layout?.samples || []).find((s) => s.sel === 'header');
const headerH = headerSample?.rect?.h ?? null;
const brokenImgs = layout?.brokenImgs ?? null;
const logoOk =
  !!logoLive &&
  logoLive.complete === true &&
  typeof logoLive.naturalWidth === 'number' &&
  logoLive.naturalWidth > 0;
const headerOk = typeof headerH === 'number' && headerH > 0 && headerH < 120;
const brokenOk = typeof brokenImgs === 'number' && brokenImgs === 0;
check('asset_logo_complete', logoOk, {
  logo: logoLive || null,
  note: 'logo.svg must be complete with naturalWidth > 0',
});
check('layout_header_height_sane', headerOk, {
  headerH,
  threshold: 120,
  sample: headerSample || null,
});
check('asset_broken_imgs_zero', brokenOk, {
  brokenImgs,
  note: 'brokenImgs = complete && naturalWidth===0 only',
});

const failed = checks.filter((c) => !c.pass);
const report = {
  ok: failed.length === 0,
  url: URL,
  waitMs: WAIT_MS,
  outDir: OUT,
  navigated,
  assetConsole: assetConsole.slice(0, 40),
  assetConsoleDenied: assetConsole.filter((t) => t.includes('denied')).length,
  assetConsoleSuspect: assetConsole.filter((t) => t.includes('complete-suspect')).length,
  assetDiag,
  sameS: {
    ok: sameSResult.ok,
    sameSequence: sameSResult.sameSequence,
    virtualSequence: sameSResult.virtualSequence,
    projectedSequence: sameSResult.projectedSequence,
    virtualTableHash: sameSResult.virtualTableHash,
    projectedTableHash: sameSResult.projectedTableHash,
  },
  planes: {
    virtualDump: virtualDump.ok
      ? {
          sequence: virtualDump.sequence,
          rowCount: virtualDump.rowCount,
          tableHash: virtualDump.tableHash,
          kinds: virtualDump.kinds,
        }
      : virtualDump,
    wire: {
      lastSeq,
      frameCount: bins.length,
      ...wire,
    },
    projected: {
      table: projectedTable,
      treeKindsRaw,
      treeKindsFiltered: treeKinds,
      treePresent: !!tree,
      cssomLive,
      cssomSheetDump: cssomDump
        ? {
            ok: cssomDump.ok,
            reason: cssomDump.reason,
            totalRules: cssomDump.totalRules,
            styleSheetCount: cssomDump.styleSheetCount,
            adoptedCount: cssomDump.adoptedCount,
          }
        : null,
      adoptedRuleDigest: adoptedDigest,
      attrSamples: {
        imgCount: attrSamples.imgs.length,
        logoAttrs: logoAttrs.slice(0, 5),
        truncatedCount: truncatedImgs.length,
      },
      layout: layout
        ? {
            overlapPairsAmong40: layout.overlapPairsAmong40,
            brokenImgs: layout.brokenImgs,
            headerH,
            logo: logoLive || null,
          }
        : null,
    },
  },
  checks,
  failed: failed.map((c) => c.id),
  oneLiner:
    failed.length === 0
      ? 'ISO PASS — DOM filtered + CSSOM text + ativo same-S (ainda não claim 1:1 visual)'
      : `ISO FAIL — ${failed.map((c) => c.id).join(', ')}`,
};

fs.writeFileSync(path.join(OUT, 'iso.json'), JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.error(`wrote ${OUT}/iso.json`);
process.exit(report.ok ? 0 : 2);
