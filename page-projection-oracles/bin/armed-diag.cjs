#!/usr/bin/env node
'use strict';
/**
 * One-site armed-gate diagnostic — prints layout/start/diff evidence.
 * Usage: SPECULUM_LIVE_ORACLES=1 node bin/armed-diag.cjs [host]
 *
 * Pass only when SurfaceHost reports data-speculum-armed=true and the active
 * iframe document is paintable (body children). Length smoke is not a pass.
 */
const http = require('http');
const BASE = process.env.SPECULUM_BASE_URL || 'http://127.0.0.1:8080';
const HOST = process.argv[2] || 'www.belezanaweb.com.br';

function encodeNavigationState(host) {
  return Buffer.from(JSON.stringify({ v: 1, h: host.trim().toLowerCase() }), 'utf8').toString('base64');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (process.env.SPECULUM_LIVE_ORACLES !== '1') {
    console.error('set SPECULUM_LIVE_ORACLES=1');
    process.exit(2);
  }
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch {
    chromium = require('patchright').chromium;
  }
  const nso = encodeURIComponent(encodeNavigationState(HOST));
  const url = `${BASE}/?_w7s_nso=${nso}`;
  console.error('[armed-diag] goto', url);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  let sessionId = null;
  page.on('request', (req) => {
    const m = /\/w7s\/api\/sessions\/([0-9a-fA-F-]{36})\//.exec(req.url());
    if (m) sessionId = m[1];
  });
  const logs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (logs.length < 40) logs.push(`${m.type()}: ${t.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  for (let i = 0; i < 40; i++) {
    const snap = await page.evaluate(() => {
      const host = document.querySelector('[data-speculum-dom-surface],[data-pp-surface-host]');
      const overlay = document.querySelector('.fixed.inset-0 .text-neutral-600');
      let docHtml = 0;
      let bodyKids = 0;
      for (const f of host?.querySelectorAll('iframe') ?? []) {
        try {
          const doc = f.contentDocument;
          if (!doc?.documentElement) continue;
          docHtml = Math.max(docHtml, (doc.documentElement.outerHTML || '').length);
          bodyKids = Math.max(bodyKids, doc.body?.childElementCount ?? 0);
        } catch {
          /* */
        }
      }
      const armed = host?.getAttribute('data-speculum-armed') === 'true';
      const paintable = bodyKids > 0;
      return {
        href: location.href,
        armed,
        paintable,
        bodyKids,
        mirrorModeSurface: Boolean(host),
        docHtml,
        overlay: overlay?.textContent?.trim().slice(0, 120) || null,
        bodyText: (document.body?.innerText || '').slice(0, 120),
      };
    });
    console.error(`[t=${i * 2}s]`, JSON.stringify(snap));
    if (snap.armed && snap.paintable) {
      console.log(JSON.stringify({ ok: true, snap, sessionId, logs: logs.slice(0, 20) }, null, 2));
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
          /* collector 3s backstop */
        }
      }
      await browser.close();
      process.exit(0);
    }
    await sleep(2000);
  }
  console.log(JSON.stringify({ ok: false, sessionId, logs }, null, 2));
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
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
