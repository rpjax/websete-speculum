#!/usr/bin/env node
/**
 * Diagnóstico layout/CSSOM no capture Beleza:
 * 1) dry-run insertRule de todo RuleNew do resync (Chrome)
 * 2) métricas de layout no Projected live (lab UI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PP = path.join(ROOT, 'packages/page-projection/dist');
const CAP = process.env.CAP_DIR || '/tmp/same-s-cssom';
const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 40000);
const OUT = process.env.OUT_DIR || `/tmp/layout-cssom-${Date.now()}`;
fs.mkdirSync(OUT, { recursive: true });

const { decodeFramePart, FramePartAssembler, PersistentStringTable, peekFrameHeader } = await import(
  pathToFileURL(path.join(PP, 'core/decode.js')).href
);
const { CONTEXT_ID_ROOT } = await import(pathToFileURL(path.join(PP, 'core/frame.js')).href);
const { OpCode } = await import(pathToFileURL(path.join(PP, 'core/opcodes.js')).href);

// --- 1) Dry-run insertRule from capture ---
const bins = fs
  .readdirSync(CAP)
  .filter((f) => /^f-\d+\.bin$/.test(f))
  .sort()
  .map((f) => new Uint8Array(fs.readFileSync(path.join(CAP, f))));

const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
let lastResync = null;
for (const bytes of bins) {
  const hdr = peekFrameHeader(bytes);
  if (hdr && hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  const decoded = decodeFramePart(bytes, strings);
  if (!decoded.ok) continue;
  const assembled = assembler.ingest(decoded.part);
  if (!assembled || typeof assembled === 'string') continue;
  if (assembled.resync) lastResync = assembled;
}

const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });

const dry = await (async () => {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const rules = (lastResync?.ops || []).filter((o) => o.op === OpCode.RuleNew);
  const sheets = (lastResync?.ops || []).filter((o) => o.op === OpCode.SheetNew);
  const texts = rules.map((r) => r.text || '');
  const result = await page.evaluate(
    ({ texts, sheetCount, baseURL }) => {
      const fails = [];
      const okBySheet = [];
      for (let s = 0; s < sheetCount; s++) {
        const sheet = new CSSStyleSheet({ baseURL });
        okBySheet.push(0);
      }
      // Resync emits all sheets then all rules; rules carry sheet id — we don't have id map here.
      // Approximate: try insert into one sheet (worst case) AND per-rule into fresh sheet.
      const one = new CSSStyleSheet({ baseURL });
      let okOne = 0;
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        try {
          one.insertRule(t, one.cssRules.length);
          okOne++;
        } catch (e) {
          fails.push({ i, err: String(e.message || e), text: t.slice(0, 160) });
        }
      }
      return {
        ruleCount: texts.length,
        sheetNewCount: sheetCount,
        insertedOkSingleSheet: okOne,
        failCount: fails.length,
        fails: fails.slice(0, 40),
        finalCssRules: one.cssRules.length,
      };
    },
    { texts, sheetCount: sheets.length, baseURL: URL },
  );
  await page.close();
  return result;
})();

fs.writeFileSync(path.join(OUT, 'insertRule-dryrun.json'), JSON.stringify(dry, null, 2));

// --- 2) Live Projected layout metrics ---
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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

const layout = await page.evaluate(() => {
  const iframe = document.querySelector('[data-pp-surface-stage] iframe, #surface iframe, iframe');
  const doc = iframe?.contentDocument;
  const win = iframe?.contentWindow;
  if (!doc || !win) return { error: 'no iframe doc' };

  const pick = (sel) => {
    const el = doc.querySelector(sel);
    if (!el) return { sel, missing: true };
    const cs = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel,
      tag: el.tagName,
      className: String(el.className || '').slice(0, 80),
      display: cs.display,
      position: cs.position,
      flex: `${cs.flexDirection}/${cs.justifyContent}/${cs.alignItems}`,
      grid: cs.gridTemplateColumns,
      width: cs.width,
      height: cs.height,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      overflow: cs.overflow,
      bg: cs.backgroundColor,
    };
  };

  const sels = [
    'header',
    '[class*="header"]',
    'nav',
    'main',
    'body',
    '[class*="search"]',
    'form',
    '.container',
    '#onetrust-banner-sdk',
  ];
  const samples = [];
  for (const sel of sels) {
    samples.push(pick(sel));
  }

  // Overlap heuristic: how many pairs of header-ish elements intersect
  const nodes = [...doc.querySelectorAll('header, nav, [class*="header"], [class*="Header"], a, button')].slice(
    0,
    80,
  );
  const rects = nodes
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el, r };
    })
    .filter((x) => x.r.width > 10 && x.r.height > 8);
  let overlaps = 0;
  for (let i = 0; i < Math.min(rects.length, 40); i++) {
    for (let j = i + 1; j < Math.min(rects.length, 40); j++) {
      const a = rects[i].r;
      const b = rects[j].r;
      const hit = !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
      if (hit) overlaps++;
    }
  }

  let adoptedRules = 0;
  let docSheetRules = 0;
  try {
    for (const s of doc.adoptedStyleSheets || []) adoptedRules += s.cssRules?.length || 0;
  } catch (_) {}
  try {
    for (const s of doc.styleSheets || []) {
      try {
        docSheetRules += s.cssRules?.length || 0;
      } catch (_) {}
    }
  } catch (_) {}

  const imgs = [...doc.images].slice(0, 30).map((img) => ({
    src: (img.currentSrc || img.src || '').slice(0, 120),
    complete: img.complete,
    natural: img.naturalWidth,
    w: img.width,
  }));
  const brokenImgs = imgs.filter((i) => i.complete && i.natural === 0).length;

  return {
    samples,
    overlapPairsAmong40: overlaps,
    adoptedRules,
    docSheetRules,
    styleEls: doc.querySelectorAll('style').length,
    linkCss: doc.querySelectorAll('link[rel~="stylesheet"]').length,
    brokenImgsSample: brokenImgs,
    imgsSample: imgs.slice(0, 8),
    bodyBg: win.getComputedStyle(doc.body).backgroundColor,
    htmlLen: doc.documentElement.outerHTML.length,
    hud: {
      frames: document.getElementById('streamFrames')?.textContent,
      apply: document.getElementById('streamApply')?.textContent,
      desync: document.getElementById('streamDesync')?.textContent,
      seq: document.getElementById('streamSeq')?.textContent,
    },
  };
});

const shot = await page.$('[data-pp-surface-stage] iframe, #surface iframe, iframe');
if (shot) {
  await shot.screenshot({ path: path.join(OUT, 'projected.png'), type: 'png' });
}

fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 2));
const summary = { out: OUT, dryRun: dry, layout };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
