#!/usr/bin/env node
'use strict';
const http = require('http');
const { chromium } = require('patchright');
const BASE = process.env.SPECULUM_BASE_URL || 'http://127.0.0.1:8080';
const HOST = process.argv[2] || 'www.eneba.com';

function enc(host) {
  return Buffer.from(JSON.stringify({ v: 1, h: host.trim().toLowerCase() }), 'utf8').toString('base64');
}
function req(method, urlPath, body) {
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
        timeout: 60_000,
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
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const KIDS_EXPR = `(() => {
  const b = document.body;
  if (!b) return null;
  return [...b.childNodes].map((n) => {
    if (n.nodeType === 3) return { k: 't', v: (n.nodeValue || '').slice(0, 40), trim: !(n.nodeValue || '').trim() };
    if (n.nodeType === 8) return { k: 'c' };
    if (n.nodeType === 1) {
      return {
        k: 'e',
        tag: n.tagName.toLowerCase(),
        kids: n.childElementCount,
        textKids: [...n.childNodes].filter((c) => c.nodeType === 3 && (c.nodeValue || '').trim()).length,
      };
    }
    return { k: n.nodeType };
  }).filter((x) => !(x.k === 't' && x.trim));
})()`;

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
  await page.goto(`${BASE}/?_w7s_nso=${encodeURIComponent(enc(HOST))}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    sessionId = sessionId || (await page.evaluate(() => window.__speculumSessionId || null));
    token = token || (await page.evaluate(() => window.__speculumSessionToken || null));
    const armed = await page.evaluate(
      () => document.querySelector('[data-speculum-dom-surface]')?.getAttribute('data-speculum-armed'),
    );
    if (armed === 'true' && sessionId && token) break;
  }
  await new Promise((r) => setTimeout(r, 5000));
  const pKids = await page.evaluate(() => {
    const host = document.querySelector('[data-speculum-dom-surface]');
    for (const f of host.querySelectorAll('iframe')) {
      try {
        const body = f.contentDocument?.body;
        if (!body) continue;
        return [...body.childNodes]
          .map((n) => {
            if (n.nodeType === 3) {
              return { k: 't', v: (n.nodeValue || '').slice(0, 40), trim: !(n.nodeValue || '').trim() };
            }
            if (n.nodeType === 8) return { k: 'c' };
            if (n.nodeType === 1) {
              return {
                k: 'e',
                tag: n.tagName.toLowerCase(),
                kids: n.childElementCount,
                textKids: [...n.childNodes].filter((c) => c.nodeType === 3 && (c.nodeValue || '').trim()).length,
                pp: n.hasAttribute('data-pp-cssom-id'),
              };
            }
            return { k: n.nodeType };
          })
          .filter((x) => !(x.k === 't' && x.trim));
      } catch {
        /* */
      }
    }
    return null;
  });
  const v = await req('POST', `/w7s/api/sessions/${sessionId}/evaluate`, {
    token,
    expression: KIDS_EXPR,
  });
  console.log('P', JSON.stringify(pKids, null, 2));
  console.log('V', JSON.stringify(v.body?.data?.evaluate ?? v.body?.evaluate ?? v.body, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
