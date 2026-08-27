'use strict';
/**
 * Diagnose blank Projected surface right after Eneba browse.start.
 * docker compose exec lab node scripts/diag-eneba-blank-boot.js
 */
process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';

const { chromium } = require('patchright');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dump(page, label) {
  const row = await page.evaluate((lbl) => {
    const host = document.querySelector('#surfaceHost iframe');
    const doc = host?.contentDocument;
    const html = doc?.documentElement?.outerHTML ?? '';
    const sheets = doc ? [...doc.styleSheets] : [];
    let cssRules = 0;
    let cssReadable = 0;
    for (const s of sheets) {
      try {
        cssRules += s.cssRules?.length ?? 0;
        cssReadable += 1;
      } catch {
        /* cross-origin */
      }
    }
    const styles = doc ? doc.querySelectorAll('style, link[rel~="stylesheet"]').length : 0;
    const imgs = doc ? [...doc.querySelectorAll('img')].slice(0, 8).map((img) => ({
      src: (img.getAttribute('src') || '').slice(0, 80),
      complete: img.complete,
      nat: img.naturalWidth,
    })) : [];
    const activity = (document.getElementById('activity')?.textContent || '').split('\n').slice(-25);
    return {
      label: lbl,
      phase: document.getElementById('chipPhase')?.textContent,
      armed: document.getElementById('dbgArmed')?.textContent,
      desync: document.getElementById('dbgDesync')?.textContent,
      seq: document.getElementById('dbgSeq')?.textContent,
      streamFrames: document.getElementById('streamFrames')?.textContent,
      streamDesync: document.getElementById('streamDesync')?.textContent,
      streamApply: document.getElementById('streamApply')?.textContent,
      htmlLen: html.length,
      bodyTextLen: (doc?.body?.innerText || '').length,
      bodyBg: doc?.body ? getComputedStyle(doc.body).backgroundColor : null,
      htmlBg: doc?.documentElement ? getComputedStyle(doc.documentElement).backgroundColor : null,
      styleTags: styles,
      styleSheets: sheets.length,
      cssReadable,
      cssRules,
      title: doc?.title ?? '',
      sample: (doc?.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 180),
      imgs,
      activityTail: activity,
    };
  }, label);
  console.log('DUMP', JSON.stringify(row, null, 2));
  return row;
}

async function main() {
  const desyncs = [];
  const applyFails = [];
  const resyncs = [];
  let dossierDir = null;

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(frame.payload);
      } catch {
        return;
      }
      if (msg.type === 'telemetry' && msg.message?.kind === 'desynced') desyncs.push(msg.message);
      if (msg.type === 'telemetry' && msg.message?.kind === 'applyResult' && msg.message?.ok === false) {
        applyFails.push(msg.message);
      }
      if (msg.type === 'session.booted' || msg.type === 'session.stopped') {
        if (msg.dossierDir) dossierDir = msg.dossierDir;
      }
    });
    ws.on('framesent', (frame) => {
      if (typeof frame.payload !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(frame.payload);
      } catch {
        return;
      }
      if (msg.type === 'client.requestResync') resyncs.push(msg);
    });
  });

  try {
    await page.goto('http://127.0.0.1:4103/', { waitUntil: 'domcontentloaded' });
    await page.click('#connect');
    await page.waitForFunction(
      () => /ws open|connected/i.test(document.getElementById('chipWs')?.textContent ?? ''),
      null,
      { timeout: 20_000 },
    );
    await page.fill('#url', 'https://www.eneba.com');
    await page.click('#browseStart');

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const frames = Number((await page.textContent('#streamFrames')) || '0');
      if (frames >= 1) break;
      await wait(300);
    }

    await dump(page, 't+0_first_frame');
    await wait(5_000);
    await dump(page, 't+5s');
    await wait(10_000);
    await dump(page, 't+15s');

    console.log('\n=== DESYNCS ===');
    for (const d of desyncs) console.log(JSON.stringify(d));
    console.log('\n=== APPLY FAILS ===');
    for (const a of applyFails) console.log(JSON.stringify(a));
    console.log(`\nDesyncs=${desyncs.length} applyFails=${applyFails.length} resyncs=${resyncs.length}`);
    if (dossierDir) console.log('Dossier:', dossierDir);
  } finally {
    await page.click('#browseStop').catch(() => undefined);
    await wait(1500);
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
