#!/usr/bin/env node
/**
 * GECKO-CSSOM-FOLHA-TARDIA — mede se regra de folha que chega DEPOIS do bootstrap viaja.
 *
 * A/B no mesmo run, na fixture `cssom-late-sheet.html`:
 *   CTRL  — folha construída + `insertRule` (tem notificação por regra)  → deve viajar
 *   DATA  — `<link href="data:text/css,…">` pós-load (regras vêm de parse) → suspeita: não viaja
 *   HTTP  — `<link href="/fixtures/…css">` pós-load (idem; MIME do lab pode recusar)
 *
 * Verdade do Virtual = a própria página reporta `cssRules.length` no DOM (JS do site, não nosso),
 * e esse texto chega pelo plano DOM. Verdade do fio = decodificar os frames e procurar o marcador.
 * Não usa HUD, não usa contagem de SHEET_NEW como prova.
 *
 * Uso: node gecko-engine/devpath/lab-cssom-late-sheet.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PP = path.join(ROOT, 'packages/page-projection/dist');

const { decodeFramePart, FramePartAssembler, PersistentStringTable, peekFrameHeader } = await import(
  pathToFileURL(path.join(PP, 'core/decode.js')).href
);
const { OpCode, NodeKind } = await import(pathToFileURL(path.join(PP, 'core/opcodes.js')).href);

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL_FIXTURE = process.env.FIXTURE_URL || `${LAB}/fixtures/cssom-late-sheet.html`;
const SETTLE_MS = Number(process.env.SETTLE_MS || 20000);
const OUT = process.env.OUT_DIR || path.join(ROOT, 'gecko-engine/devpath/captures', `cssom-late-${Date.now()}`);
fs.mkdirSync(OUT, { recursive: true });

const MARKS = ['CTRLMARK', 'DATAMARK', 'HTTPMARK'];

const bins = [];
let sameSResult = null;
const navigated = [];

const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.webSocketFrameReceived', (params) => {
  const payload = params.response?.payloadData;
  if (!payload) return;
  if (params.response?.opcode === 2) {
    bins.push(new Uint8Array(Buffer.from(payload, 'base64')));
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
  if (msg.type === 'lab.sameSResult') sameSResult = msg;
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
}, URL_FIXTURE);
await page.click('button:has-text("Start Virtual")');
await page.waitForTimeout(SETTLE_MS);

// Halt → Flush → Snapshot oficial (dump da tabela C++, não page.evaluate no Virtual).
await page.locator('#browseSnap').evaluate((el) => el.click());
const deadline = Date.now() + 25000;
while (!sameSResult && Date.now() < deadline) await page.waitForTimeout(250);

/** Superfície projetada: cor pintada + o auto-relato do Virtual que veio pelo DOM. */
const projected = await page.evaluate(() => {
  const host = document.getElementById('surfaceHost') || document;
  let doc = null;
  for (const f of host.querySelectorAll('iframe')) {
    try {
      const d = f.contentDocument;
      if (d?.body && (d.body.innerText || '').length > 40) {
        doc = d;
        break;
      }
    } catch {
      /* cross-origin */
    }
  }
  if (!doc) return { ok: false, reason: 'no_projected_doc' };
  const bg = (sel) => {
    const el = doc.querySelector(sel);
    if (!el) return null;
    return doc.defaultView.getComputedStyle(el).backgroundColor;
  };
  const txt = (sel) => (doc.querySelector(sel)?.textContent || '').trim();
  return {
    ok: true,
    // Auto-relato do Virtual, entregue pelo plano DOM:
    virtualSelfReport: {
      phase: txt('#phase'),
      ctrlRules: txt('#ctrlRules'),
      dataRules: txt('#dataRules'),
      httpRules: txt('#httpRules'),
      httpOutcome: txt('#httpOutcome'),
    },
    // O que a superfície projetada realmente pinta:
    painted: {
      ctrl: bg('#ctrl-marker'),
      data: bg('#data-marker'),
      http: bg('#http-marker'),
    },
    linkPresentInProjectedDom: {
      data: !!doc.getElementById('data-link'),
      http: !!doc.getElementById('http-link'),
    },
    projectedSheetHrefs: [...doc.styleSheets].map((s) => (s.href || '(inline/adopted)').slice(-48)),
  };
});

try {
  const handle = await page.$('#surfaceHost iframe, iframe');
  if (handle) fs.writeFileSync(path.join(OUT, 'projected-surface.png'), await handle.screenshot({ type: 'png' }));
} catch {
  /* ignore */
}

await browser.close();

// ---- fio: decodifica tudo e procura cada marcador nos textos de regra ----
const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
const wire = {
  frames: 0,
  sheetNew: 0,
  ruleNew: 0,
  ruleSet: 0,
  resyncFrames: 0,
  decodeFail: 0,
  marks: Object.fromEntries(MARKS.map((m) => [m, 0])),
  markerRuleSample: {},
};
for (const bytes of bins) {
  const hdr = peekFrameHeader(bytes);
  if (hdr && hdr.contextId !== 1 && hdr.contextId !== 0) continue;
  const decoded = decodeFramePart(bytes, strings);
  if (!decoded.ok) {
    wire.decodeFail += 1;
    continue;
  }
  const assembled = assembler.ingest(decoded.part);
  if (!assembled || typeof assembled === 'string') continue;
  wire.frames += 1;
  if (assembled.resync) wire.resyncFrames += 1;
  for (const op of assembled.ops) {
    if (op.op === OpCode.SheetNew) wire.sheetNew += 1;
    if (op.op !== OpCode.RuleNew && op.op !== OpCode.RuleSet) continue;
    if (op.op === OpCode.RuleNew) wire.ruleNew += 1;
    else wire.ruleSet += 1;
    const text = String(op.text || '');
    for (const m of MARKS) {
      if (!text.includes(m)) continue;
      wire.marks[m] += 1;
      if (!wire.markerRuleSample[m]) wire.markerRuleSample[m] = text.slice(0, 120);
    }
  }
}

const dumpBytes = sameSResult?.virtual?.dumpBytes ? Buffer.from(sameSResult.virtual.dumpBytes, 'base64') : null;
let virtualDump = null;
if (dumpBytes && dumpBytes.length >= 28) {
  const u32 = (o) => dumpBytes.readUInt32LE(o);
  const rowCount = u32(20);
  const kindHist = {};
  let o = 28;
  for (let i = 0; i < rowCount && o + 20 <= dumpBytes.length; i++) {
    const kind = u32(o + 4);
    kindHist[kind] = (kindHist[kind] || 0) + 1;
    o += 20;
  }
  virtualDump = {
    sequence: u32(0),
    generation: u32(4),
    contextId: u32(8),
    rowCount,
    sheets: kindHist[NodeKind.Sheet] || 0,
    rules: kindHist[NodeKind.Rule] || 0,
    elements: kindHist[NodeKind.Element] || 0,
  };
}

const self = projected.virtualSelfReport || {};
const virtualHas = {
  CTRLMARK: Number(self.ctrlRules || 0) > 0,
  DATAMARK: Number(self.dataRules || 0) > 0,
  HTTPMARK: Number(self.httpRules || 0) > 0,
};

const perMark = MARKS.map((m) => ({
  mark: m,
  virtualHasRules: virtualHas[m],
  rulesOnWire: wire.marks[m],
  verdict: !virtualHas[m]
    ? 'inconclusive_virtual_missing'
    : wire.marks[m] > 0
      ? 'travelled'
      : 'LOST_ON_WIRE',
}));

const report = {
  fixture: URL_FIXTURE,
  settleMs: SETTLE_MS,
  outDir: OUT,
  navigated,
  virtualSelfReport: self,
  projected: {
    ok: projected.ok,
    painted: projected.painted,
    linkPresentInProjectedDom: projected.linkPresentInProjectedDom,
    projectedSheetHrefs: projected.projectedSheetHrefs,
  },
  virtualTableDump: virtualDump,
  sameS: sameSResult
    ? {
        ok: sameSResult.ok,
        sameSequence: sameSResult.sameSequence ?? null,
        virtualSequence: sameSResult.virtualSequence ?? null,
        projectedSequence: sameSResult.projectedSequence ?? null,
      }
    : { ok: false, error: 'no_lab_sameSResult' },
  wire,
  perMark,
  conclusion: perMark.some((p) => p.verdict === 'LOST_ON_WIRE')
    ? 'CONFIRMADO: regra existente no Virtual não viajou'
    : perMark.every((p) => p.verdict === 'travelled')
      ? 'NAO reproduzido: tudo que o Virtual tem viajou'
      : 'inconclusivo — ver perMark',
};

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.error(`wrote ${OUT}/report.json`);
process.exit(report.conclusion.startsWith('CONFIRMADO') ? 3 : 0);
