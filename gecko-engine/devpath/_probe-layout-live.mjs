import patchright from '../../sidecar/node_modules/patchright/index.js';

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 40000);

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

const probe = await page.evaluate(async () => {
  const frames = [...document.querySelectorAll('iframe')].map((f) => ({
    src: (f.getAttribute('src') || '').slice(0, 100),
    w: f.offsetWidth,
    h: f.offsetHeight,
  }));

  let doc = null;
  let win = null;
  for (const f of document.querySelectorAll('iframe')) {
    try {
      const d = f.contentDocument;
      if (d?.body && (d.body.innerText || '').length > 80) {
        doc = d;
        win = f.contentWindow;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (!doc || !win) {
    return {
      ok: false,
      reason: 'no_projected_doc',
      frames,
      sw: !!navigator.serviceWorker?.controller,
    };
  }

  const cs = (el) => {
    if (!el) return null;
    const s = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      className: String(el.className || '').slice(0, 120),
      display: s.display,
      position: s.position,
      flexDirection: s.flexDirection,
      justifyContent: s.justifyContent,
      alignItems: s.alignItems,
      width: s.width,
      height: s.height,
      maxWidth: s.maxWidth,
      minWidth: s.minWidth,
      writingMode: s.writingMode,
      whiteSpace: s.whiteSpace,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily.slice(0, 100),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  };

  const header = doc.querySelector('header');
  const candidates = [
    'a.logo',
    '[class*="logo"]',
    'header img',
    'header svg',
    '.header-wrapper a',
    'header a',
  ];
  const picked = {};
  for (const sel of candidates) {
    const el = doc.querySelector(sel);
    if (el) picked[sel] = { ...cs(el), html: el.outerHTML.slice(0, 280) };
  }

  // narrow text nodes under header
  const narrow = [];
  if (header) {
    for (const el of header.querySelectorAll('a, span, div, p, h1, strong')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.width < 40 && r.height > 80) {
        narrow.push({
          tag: el.tagName,
          className: String(el.className || '').slice(0, 80),
          text: (el.textContent || '').slice(0, 40),
          ...cs(el),
        });
        if (narrow.length >= 6) break;
      }
    }
  }

  const imgs = [...doc.images].slice(0, 25).map((img) => ({
    src: (img.currentSrc || img.src || '').slice(0, 140),
    complete: img.complete,
    nw: img.naturalWidth,
    w: img.width,
    h: img.height,
  }));

  const base = doc.querySelector('base')?.href || null;
  let sheet0Base = null;
  try {
    const ado = doc.adoptedStyleSheets?.[1] || doc.adoptedStyleSheets?.[0];
    sheet0Base = ado ? String(ado.href || ado.ownerNode || 'constructed') : null;
  } catch {
    sheet0Base = 'err';
  }

  // sample whether main CSS rule applies
  let probeEl = doc.createElement('div');
  probeEl.className = 'visible-lg';
  probeEl.style.cssText = 'position:absolute;left:-9999px';
  doc.body.appendChild(probeEl);
  const visibleLg = win.getComputedStyle(probeEl).display;
  probeEl.remove();

  return {
    ok: true,
    swController: !!navigator.serviceWorker?.controller,
    frames,
    base,
    sheet0Base,
    adopted: doc.adoptedStyleSheets?.length ?? 0,
    styleSheets: doc.styleSheets.length,
    header: cs(header),
    picked,
    narrow,
    visibleLgDisplay: visibleLg,
    brokenImgs: imgs.filter((i) => i.complete && i.nw === 0).length,
    imgs,
    bodyBg: win.getComputedStyle(doc.body).backgroundColor,
  };
});

console.log(JSON.stringify(probe, null, 2));
await browser.close();
process.exit(probe.ok ? 0 : 2);
