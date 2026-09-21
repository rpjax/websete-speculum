#!/usr/bin/env node
import patchright from '../../sidecar/node_modules/patchright/index.js';

const LAB = 'http://127.0.0.1:4077';
const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`${LAB}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('#connect');
await page.waitForTimeout(2500);

const probe = await page.evaluate(() => {
  const host = document.getElementById('surfaceHost');
  const iframes = [...(host?.querySelectorAll('iframe') || [])];
  let doc = null;
  for (const f of iframes) {
    try {
      const d = f.contentDocument;
      if (d?.body && (d.body.innerText || '').length > 80) {
        doc = d;
        break;
      }
    } catch {
      /* */
    }
  }
  const hud = {
    frames: document.getElementById('streamFrames')?.textContent,
    gen: document.getElementById('streamGen')?.textContent,
    seq: document.getElementById('streamSeq')?.textContent,
    desync: document.getElementById('streamDesync')?.textContent,
    resync: document.getElementById('streamResync')?.textContent,
    phase: document.getElementById('chipPhase')?.textContent,
    activity: [...document.querySelectorAll('#activity > div')]
      .slice(0, 25)
      .map((d) => d.textContent),
  };
  if (!doc) return { hud, ok: false };
  const bases = [...doc.querySelectorAll('base')].map((b) => b.href);
  const h1 = doc.querySelector('h1');
  const productish = [...doc.querySelectorAll('a[href*="kit-wella"], [class*="product-name"], [data-testid]')]
    .slice(0, 10)
    .map((el) => ({
      tag: el.tagName,
      text: (el.innerText || '').trim().slice(0, 70),
      href: (el.getAttribute?.('href') || '').slice(0, 140),
    }));
  return {
    ok: true,
    hud,
    title: doc.title,
    bases,
    locationHref: doc.defaultView?.location?.href ?? null,
    h1: (h1?.innerText || '').trim().slice(0, 120),
    bodyStart: (doc.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
    productish,
  };
});

console.log(JSON.stringify(probe, null, 2));
await browser.close();
