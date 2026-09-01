#!/usr/bin/env node
'use strict';
const http = require('http');
const { chromium } = require('patchright');

const BASE = process.env.SPECULUM_BASE_URL || 'http://127.0.0.1:8080';

function encodeNavigationState(host) {
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
        timeout: 30_000,
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
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
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
      const u = new URL(req.url());
      const t = u.searchParams.get('speculum-session-token');
      if (t) token = t;
    } catch {
      /* */
    }
  });
  const nso = encodeURIComponent(encodeNavigationState('www.belezanaweb.com.br'));
  await page.goto(`${BASE}/?_w7s_nso=${nso}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const snap = await page.evaluate(() => {
      const host = document.querySelector('[data-speculum-dom-surface]');
      let docHtml = 0;
      let textLen = 0;
      let title = '';
      for (const f of host?.querySelectorAll('iframe') ?? []) {
        try {
          const d = f.contentDocument;
          if (!d) continue;
          docHtml = Math.max(docHtml, (d.documentElement?.outerHTML || '').length);
          textLen = Math.max(textLen, (d.body?.innerText || '').trim().length);
          title = d.title || title;
        } catch {
          /* */
        }
      }
      return {
        href: location.href,
        armed: host?.getAttribute('data-speculum-armed'),
        docHtml,
        textLen,
        title,
        sid: window.__speculumSessionId || null,
        tok: window.__speculumSessionToken || null,
      };
    });
    console.log(`t=${i * 2}s`, JSON.stringify(snap));
    sessionId = sessionId || snap.sid;
    token = token || snap.tok;
    if (snap.armed === 'true' && snap.docHtml > 1000) break;
  }
  console.log('binding', { sessionId, token: Boolean(token) });
  if (sessionId && token) {
    const ev = await req('POST', `/w7s/api/sessions/${sessionId}/evaluate`, {
      token,
      expression:
        '({url:location.href,title:document.title,ready:document.readyState,bodyLen:(document.body&&document.body.innerText||"").length,htmlLen:(document.documentElement&&document.documentElement.outerHTML||"").length})',
    });
    console.log('virtual', JSON.stringify(ev).slice(0, 800));
  }
  try {
    if (sessionId) {
      await page.evaluate(async () => {
        if (typeof window.__speculumStopSession === 'function') await window.__speculumStopSession();
      });
    }
  } catch {
    /* */
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
