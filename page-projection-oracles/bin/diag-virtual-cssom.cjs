#!/usr/bin/env node
'use strict';
const http = require('http');
const { chromium } = require('patchright');
const BASE = process.env.SPECULUM_BASE_URL || 'http://127.0.0.1:8080';
const HOST = process.argv[2] || 'www.belezanaweb.com.br';

function encodeNavigationState(host) {
  return Buffer.from(JSON.stringify({ v: 1, h: host.trim().toLowerCase() }), 'utf8').toString('base64');
}
function req(method, urlPath, body, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath.startsWith('http') ? urlPath : `${BASE}${urlPath}`);
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode, body: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode, body: text });
          }
        });
      },
    );
    r.on('timeout', () => {
      r.destroy();
      reject(new Error('timeout'));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  let sessionId = null;
  let token = null;
  page.on('request', (req) => {
    const m = /\/w7s\/api\/sessions\/([0-9a-fA-F-]{36})\//.exec(req.url());
    if (m) sessionId = m[1];
    try {
      const t = new URL(req.url()).searchParams.get('speculum-session-token');
      if (t) token = t;
    } catch {
      /* */
    }
  });
  const nso = encodeURIComponent(encodeNavigationState(HOST));
  await page.goto(`${BASE}/?_w7s_nso=${nso}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    sessionId = sessionId || (await page.evaluate(() => window.__speculumSessionId || null));
    token = token || (await page.evaluate(() => window.__speculumSessionToken || null));
    const snap = await page.evaluate(() => {
      const host = document.querySelector('[data-speculum-dom-surface]');
      let docHtml = 0;
      for (const f of host?.querySelectorAll('iframe') ?? []) {
        try {
          docHtml = Math.max(docHtml, (f.contentDocument?.documentElement?.outerHTML || '').length);
        } catch {
          /* */
        }
      }
      return {
        armed: host?.getAttribute('data-speculum-armed'),
        docHtml,
        href: location.href,
      };
    });
    console.log(`t=${i * 3}s`, JSON.stringify({ ...snap, sessionId: Boolean(sessionId), token: Boolean(token) }));
    if (sessionId && token) break;
  }
  if (!sessionId || !token) {
    console.log('no binding');
    await browser.close();
    process.exit(1);
  }
  const ev = await req('POST', `/w7s/api/sessions/${sessionId}/evaluate`, {
    token,
    expression: `(() => {
      const api = window.__speculumPageProjectionV2;
      let snap = null;
      try { snap = api && api.snapshotCssom ? api.snapshotCssom() : null; } catch (e) { snap = { err: String(e) }; }
      const sheets = document.styleSheets ? document.styleSheets.length : -1;
      let readable = 0, xo = 0;
      for (let i = 0; i < sheets; i++) {
        try {
          const r = document.styleSheets[i].cssRules;
          readable += r ? r.length : 0;
        } catch { xo += 1; }
      }
      return {
        url: location.href,
        title: document.title,
        ready: document.readyState,
        bodyLen: (document.body && document.body.innerText || '').length,
        htmlLen: (document.documentElement && document.documentElement.outerHTML || '').length,
        hasApi: Boolean(api),
        styleSheets: sheets,
        readableRules: readable,
        xoSheets: xo,
        snapSheetCount: Array.isArray(snap) ? snap.length : null,
        snapRuleCount: Array.isArray(snap) ? snap.reduce((n,s)=>n+(s.rules?s.rules.length:0),0) : null,
        snapErr: snap && snap.err ? snap.err : null,
      };
    })()`,
  });
  console.log('virtual', JSON.stringify(ev, null, 2).slice(0, 2000));
  try {
    await page.evaluate(async () => {
      if (typeof window.__speculumStopSession === 'function') await window.__speculumStopSession();
    });
  } catch {
    /* */
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
