#!/usr/bin/env node
/**
 * Lab UI: Start Virtual + mede CSSOM Projected (styleSheets/cssRules) vs HUD.
 * Uso: node gecko-engine/devpath/lab-projected-cssom-probe.mjs [url]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 45000);
const OUT = process.env.OUT_DIR || `/tmp/projected-cssom-${Date.now()}`;
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
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

const report = await page.evaluate(() => {
  const iframe = document.querySelector('[data-pp-surface-stage] iframe, #surface iframe, iframe');
  const doc = iframe?.contentDocument;
  const sheets = [];
  let readableRules = 0;
  let unreadable = 0;
  let emptySheets = 0;
  const walkSheetList = (list, origin) => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      let n = null;
      let err = null;
      try {
        n = s.cssRules ? s.cssRules.length : 0;
        readableRules += n;
        if (n === 0) emptySheets += 1;
      } catch (e) {
        err = String(e?.message || e);
        unreadable += 1;
      }
      sheets.push({
        origin,
        href: s.href || null,
        owner: s.ownerNode?.nodeName || null,
        ownerId: s.ownerNode?.id || null,
        disabled: !!s.disabled,
        rules: n,
        err,
      });
    }
  };
  if (doc) {
    walkSheetList(doc.styleSheets, 'document.styleSheets');
    try {
      if (doc.adoptedStyleSheets?.length) {
        walkSheetList(doc.adoptedStyleSheets, 'document.adoptedStyleSheets');
      }
    } catch (_) {
      /* ignore */
    }
  }
  const styleEls = doc ? doc.querySelectorAll('style').length : 0;
  const linkCss = doc ? doc.querySelectorAll('link[rel~="stylesheet"]').length : 0;
  const hud = {
    frames: document.getElementById('streamFrames')?.textContent,
    apply: document.getElementById('streamApply')?.textContent,
    desync: document.getElementById('streamDesync')?.textContent,
    seq: document.getElementById('streamSeq')?.textContent,
    gen: document.getElementById('streamGen')?.textContent,
  };
  return {
    sheetCount: doc?.styleSheets?.length ?? 0,
    readableRules,
    unreadable,
    emptySheets,
    styleEls,
    linkCss,
    sheets: sheets.slice(0, 40),
    bodyChildren: doc?.body?.childElementCount ?? 0,
    htmlLen: doc?.documentElement?.outerHTML?.length ?? 0,
    hud,
  };
});

fs.writeFileSync(path.join(OUT, 'projected-cssom.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, ...report }, null, 2));
await browser.close();
