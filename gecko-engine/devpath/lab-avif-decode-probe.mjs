#!/usr/bin/env node
/**
 * AVIF decode fork — blob Image vs <img> quebrado no iframe Projected.
 * Um cold Beleza; não declara Fixed.
 *
 *   node gecko-engine/devpath/lab-avif-decode-probe.mjs [url]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 45000);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
const OUT =
  process.env.OUT_DIR ||
  path.join(ROOT, 'gecko-engine/devpath/captures', `avif-decode-${stamp}`);
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

const result = await page.evaluate(async () => {
  const iframe = document.querySelector('#surface iframe, iframe');
  const doc = iframe?.contentDocument;
  const win = iframe?.contentWindow;
  if (!doc || !win) return { ok: false, reason: 'no_iframe' };

  const broken = [...doc.images].filter((i) => i.complete && i.naturalWidth === 0);
  const isTracker = (s) => /bat\.bing\.com/i.test(s) || /\/action\/0(\?|$)/i.test(s);
  const avifImg =
    broken.find((i) => {
      const s = i.currentSrc || i.src || '';
      return /f_avif|cloudinary/i.test(s) && !isTracker(s);
    }) ||
    [...doc.images].find((i) => /f_avif/i.test(i.currentSrc || i.src || '')) ||
    broken.find((i) => !isTracker(i.currentSrc || i.src || '')) ||
    null;
  if (!avifImg) {
    const nonTrackerBroken = broken.filter((i) => !isTracker(i.currentSrc || i.src || '')).length;
    return {
      ok: true,
      reason: nonTrackerBroken === 0 ? 'no_broken_content_imgs' : 'no_avif_img',
      brokenCount: broken.length,
      nonTrackerBroken,
      imgCount: doc.images.length,
      verdict: nonTrackerBroken === 0 ? 'avif_ok_no_content_broken' : 'unknown',
      cause: nonTrackerBroken === 0 ? 'only_tracker_or_none_broken' : null,
      fixHint: null,
    };
  }

  const src = avifImg.currentSrc || avifImg.src;
  const pageImg = {
    src: String(src).slice(0, 220),
    complete: avifImg.complete,
    naturalWidth: avifImg.naturalWidth,
    naturalHeight: avifImg.naturalHeight,
  };

  let pageDecode = null;
  try {
    await avifImg.decode();
    pageDecode = {
      ok: true,
      naturalWidth: avifImg.naturalWidth,
      naturalHeight: avifImg.naturalHeight,
    };
  } catch (e) {
    pageDecode = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      naturalWidth: avifImg.naturalWidth,
    };
  }

  let fetchInfo = null;
  let blobImage = null;
  let createBitmap = null;
  try {
    const res = await win.fetch(src, { credentials: 'omit' });
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf.slice(0, 16));
    const headHex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    fetchInfo = {
      status: res.status,
      contentType: res.headers.get('content-type'),
      byteLength: buf.byteLength,
      headHex,
      looksAvif: headHex.includes('66747970') && headHex.includes('61766966'),
    };

    const blob = new Blob([buf], { type: res.headers.get('content-type') || 'image/avif' });
    const objUrl = win.URL.createObjectURL(blob);
    try {
      const im = new win.Image();
      await new Promise((resolve, reject) => {
        im.onload = () => resolve(null);
        im.onerror = () => reject(new Error('blob_image_error'));
        im.src = objUrl;
      });
      blobImage = {
        ok: true,
        naturalWidth: im.naturalWidth,
        naturalHeight: im.naturalHeight,
        complete: im.complete,
      };
    } catch (e) {
      blobImage = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        naturalWidth: 0,
      };
    }

    try {
      const bmp = await win.createImageBitmap(blob);
      createBitmap = { ok: true, width: bmp.width, height: bmp.height };
      bmp.close();
    } catch (e) {
      createBitmap = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    win.URL.revokeObjectURL(objUrl);
  } catch (e) {
    fetchInfo = { error: e instanceof Error ? e.message : String(e) };
  }

  const ua = win.navigator.userAgent;
  const blobNw = Number(blobImage?.naturalWidth || 0);
  const pageNw = Number(pageImg.naturalWidth || 0);
  let verdict = 'unknown';
  let cause = null;
  let fixHint = null;
  if (pageNw > 0 && blobNw > 0) {
    verdict = 'page_img_and_blob_ok';
    cause = 'avif_decodes_on_page_img';
    fixHint = null;
  } else if (blobNw > 0 && pageNw === 0) {
    verdict = 'sticky_or_element_state';
    cause = 'blob_Image_decodes_but_page_img_nw0';
    fixHint =
      'Bytes/Chromium AVIF OK. Problema no <img> da página (load sticky, src apply timing, ou erro cacheado).';
  } else if (blobNw === 0 && (blobImage?.ok === false || blobNw === 0)) {
    verdict = 'chromium_cannot_decode_avif';
    cause = 'blob_Image_and_page_img_both_nw0';
    fixHint =
      'Chromium do lab Projected não decoda AVIF (ou tipo/blob). Fix: engine AVIF no browser do Projected / lab Chromium, não tee.';
  }

  return {
    ok: true,
    ua: ua.slice(0, 160),
    brokenCount: broken.length,
    pageImg,
    pageDecode,
    fetchInfo,
    blobImage,
    createBitmap,
    verdict,
    cause,
    fixHint,
  };
});

await browser.close();

const report = {
  url: URL,
  waitMs: WAIT_MS,
  outDir: OUT,
  ...result,
  siteAccept: 'not Fixed — decode fork only',
};
fs.writeFileSync(path.join(OUT, 'avif-decode-probe.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(
  result?.verdict === 'page_img_and_blob_ok' || result?.verdict === 'avif_ok_no_content_broken'
    ? 0
    : result?.verdict && result.verdict !== 'unknown'
      ? 0
      : 2,
);
