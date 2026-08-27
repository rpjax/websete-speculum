'use strict';
/**
 * Eneba precondition isolation via lab UI + WebSocket tap (Projected path).
 * docker compose exec lab node scripts/diag-eneba-precondition-ui.js
 */
process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';

const { chromium } = require('patchright');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const desyncs = [];
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
      if (msg.type === 'telemetry' && msg.message?.kind === 'desynced') {
        desyncs.push(msg.message);
      }
      if (msg.type === 'session.booted' && msg.dossierDir) dossierDir = msg.dossierDir;
      if (msg.type === 'session.stopped' && msg.dossierDir) dossierDir = msg.dossierDir;
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
      await wait(400);
    }
    await wait(12_000);
    const boot = await page.evaluate(() => ({
      frames: document.getElementById('streamFrames')?.textContent,
      phase: document.getElementById('chipPhase')?.textContent,
      htmlLen: document.querySelector('#surfaceHost iframe')?.contentDocument?.documentElement?.outerHTML?.length ?? 0,
    }));
    console.log('BOOT', JSON.stringify(boot));

    // Sim click on projected surface
    const sim = await page.evaluate(() => {
      const host = document.querySelector('#surfaceHost iframe');
      const doc = host?.contentDocument;
      if (!doc) return { ok: false, reason: 'no projected doc' };
      const btn = [...doc.querySelectorAll('button')].find((b) => /^sim$/i.test((b.textContent || '').trim()));
      if (!btn) return { ok: false, reason: 'no sim', n: doc.querySelectorAll('button').length };
      btn.click();
      return { ok: true };
    });
    console.log('SIM', JSON.stringify(sim));
    await wait(10_000);

    await page.click('#browseStop').catch(() => undefined);
    await wait(2000);
  } finally {
    await browser.close();
  }

  console.log('\n=== DESYNCS (full telemetry) ===');
  for (const d of desyncs) console.log(JSON.stringify(d));

  const first = desyncs[0];
  if (!first) {
    console.log('\nNo desync in capture window.');
    return;
  }

  console.log('\n=== FIRST FAILURE ===');
  console.log(
    JSON.stringify(
      {
        errorCode: first.errorCode,
        op: first.op,
        id: first.id,
        sequence: first.sequence,
        generation: first.generation,
        expected: first.expected,
        actual: first.actual,
        message: first.message,
        phase: first.phase,
        contextId: first.contextId,
      },
      null,
      2,
    ),
  );

  if (first.op === 'preTableHash') {
    console.log(
      `\nEXACT CAUSE: frame seq ${first.sequence} (gen ${first.generation}) — producer preTableHash ${first.expected} ≠ client table ${first.actual} before phase-1 apply.`,
    );
  } else if (first.op === 'check') {
    console.log(
      `\nEXACT CAUSE: frame seq ${first.sequence} — closing CHECK expected ${first.expected} ≠ client table ${first.actual}.`,
    );
  } else {
    console.log(`\nEXACT CAUSE: precondition on op '${first.op}' id ${first.id}: ${first.message || '(no message)'}`);
  }

  console.log(`\nDesync count: ${desyncs.length}, resync sends: ${resyncs.length}`);
  if (dossierDir) console.log('Dossier:', dossierDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
