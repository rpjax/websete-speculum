#!/usr/bin/env node
'use strict';
const http = require('http');
const { chromium } = require('patchright');
const BASE = process.env.SPECULUM_BASE_URL || 'http://127.0.0.1:8080';
const HOST = process.argv[2] || 'www.belezanaweb.com.br';

function enc(host) {
  return Buffer.from(JSON.stringify({ v: 1, h: host.trim().toLowerCase() }), 'utf8').toString('base64');
}
function req(method, urlPath, body, timeoutMs = 120_000) {
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
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          let parsed = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* binary resync body */
          }
          resolve({ status: res.statusCode, body: parsed, bytes: buf.length });
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
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
  const nso = encodeURIComponent(enc(HOST));
  const t0 = Date.now();
  await page.goto(`${BASE}/?_w7s_nso=${nso}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
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
      return { armed: host?.getAttribute('data-speculum-armed'), docHtml };
    });
    let virt = null;
    let rs = null;
    if (sessionId && token) {
      try {
        const ev = await req('POST', `/w7s/api/sessions/${sessionId}/evaluate`, {
          token,
          expression:
            '({url:location.href,htmlLen:(document.documentElement&&document.documentElement.outerHTML||"").length,ready:document.readyState})',
        });
        virt = ev.body?.data?.evaluate ?? ev.body?.evaluate ?? ev.body;
      } catch (e) {
        virt = String(e);
      }
      try {
        const u = `/w7s/api/sessions/${sessionId}/page-projection/resync?generation=1&sequence=0&speculum-session-token=${encodeURIComponent(token)}`;
        const r = await req('POST', u, null, 180_000);
        rs = {
          status: r.status,
          bytes: r.bytes,
          err:
            r.body && typeof r.body === 'object'
              ? r.body.errorCode || r.body.message
              : typeof r.body === 'string'
                ? r.body.slice(0, 80)
                : undefined,
        };
      } catch (e) {
        rs = String(e);
      }
    }
    console.log(JSON.stringify({ t: Math.round((Date.now() - t0) / 1000), snap, virt, rs }));
    if (snap.armed === 'true' && snap.docHtml > 1000) break;
    if (virt && virt.errorCode === 'session_gone') break;
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
