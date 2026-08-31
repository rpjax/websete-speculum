#!/usr/bin/env node
'use strict';
/** Quick M2 surface check: arm + cssom + broken imgs for one host. */
const http = require('http');
const BASE = process.env.SPECULUM_BASE_URL || 'http://127.0.0.1:8080';
const HOST = process.argv[2] || 'www.eneba.com';

function enc(h) {
  return Buffer.from(JSON.stringify({ v: 1, h: h.trim().toLowerCase() }), 'utf8').toString('base64');
}

async function main() {
  if (process.env.SPECULUM_LIVE_ORACLES !== '1') {
    console.error('set SPECULUM_LIVE_ORACLES=1');
    process.exit(2);
  }
  let chromium;
  try {
    chromium = require('patchright').chromium;
  } catch {
    chromium = require('playwright').chromium;
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  let sessionId = null;
  page.on('request', (req) => {
    const m = /\/w7s\/api\/sessions\/([0-9a-fA-F-]{36})\//.exec(req.url());
    if (m) sessionId = m[1];
  });
  await page.goto(`${BASE}/?_w7s_nso=${encodeURIComponent(enc(HOST))}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  let last = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    last = await page.evaluate(() => {
      const host = document.querySelector('[data-speculum-dom-surface]');
      let docHtml = 0;
      let styleEls = 0;
      let ownedRules = 0;
      let brokenImgs = 0;
      let imgs = 0;
      let bg = '';
      for (const f of host?.querySelectorAll('iframe') ?? []) {
        try {
          const d = f.contentDocument;
          if (!d?.documentElement) continue;
          docHtml = Math.max(docHtml, (d.documentElement.outerHTML || '').length);
          styleEls = Math.max(styleEls, d.querySelectorAll('style[data-pp-cssom-id]').length);
          let rules = 0;
          for (const s of d.querySelectorAll('style[data-pp-cssom-id]')) {
            try {
              rules += s.sheet?.cssRules?.length ?? 0;
            } catch {
              /* */
            }
          }
          ownedRules = Math.max(ownedRules, rules);
          const list = [...(d.images || [])];
          imgs = Math.max(imgs, list.length);
          brokenImgs = Math.max(
            brokenImgs,
            list.filter((img) => img.complete && img.naturalWidth === 0).length,
          );
          bg = d.body ? getComputedStyle(d.body).backgroundColor : '';
        } catch {
          /* */
        }
      }
      return {
        armed: host?.getAttribute('data-speculum-armed') === 'true',
        docHtml,
        styleEls,
        ownedRules,
        imgs,
        brokenImgs,
        bg,
      };
    });
    if (last.armed && last.docHtml > 1000) break;
  }
  console.log(JSON.stringify({ host: HOST, sessionId, ...last }, null, 2));
  if (sessionId) {
    try {
      await new Promise((resolve, reject) => {
        const r = http.request(
          `${BASE}/w7s/api/admin/maintenance/sessions/${sessionId}`,
          { method: 'DELETE', timeout: 10_000 },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        r.on('error', reject);
        r.end();
      });
    } catch {
      /* */
    }
  }
  await browser.close();
  const ok =
    last?.armed
    && last.docHtml > 1000
    && last.ownedRules > 0
    && last.brokenImgs < Math.max(3, Math.floor((last.imgs || 0) * 0.5));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
