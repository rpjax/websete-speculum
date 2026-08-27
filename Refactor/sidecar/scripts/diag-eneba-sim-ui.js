'use strict';
/** Lab UI path — projected iframe dump after Eneba Sim click. */
process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
const { chromium } = require('patchright');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dumpProjected(page, label) {
  const dump = await page.evaluate((lbl) => {
    const host = document.querySelector('#surfaceHost iframe');
    const doc = host && host.contentDocument;
    const html = doc?.documentElement?.outerHTML ?? '';
    const body = doc?.body;
    return {
      label: lbl,
      frames: document.getElementById('streamFrames')?.textContent,
      phase: document.getElementById('chipPhase')?.textContent,
      armed: document.getElementById('dbgArmed')?.textContent,
      desync: document.getElementById('dbgDesync')?.textContent,
      seq: document.getElementById('dbgSeq')?.textContent,
      htmlLen: html.length,
      bodyLen: body?.innerHTML?.length ?? 0,
      bodyTextLen: (body?.innerText || '').length,
      title: doc?.title ?? '',
      bg: body ? getComputedStyle(body).backgroundColor : null,
      childCount: body?.childElementCount ?? 0,
      sample: (body?.innerText || '').slice(0, 200),
      htmlBg: doc?.documentElement ? getComputedStyle(doc.documentElement).backgroundColor : null,
      streamDesync: document.getElementById('streamDesync')?.textContent,
      streamApply: document.getElementById('streamApply')?.textContent,
      streamFrames: document.getElementById('streamFrames')?.textContent,
    };
  }, label);
  console.log('UI_DUMP', JSON.stringify(dump));
  return dump;
}

async function clickSimInProjected(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#surfaceHost iframe');
    const doc = host && host.contentDocument;
    if (!doc) return { ok: false, reason: 'no projected doc' };
    const buttons = [...doc.querySelectorAll('button')];
    const sim = buttons.find((b) => /^sim$/i.test((b.textContent || '').trim()));
    if (!sim) return { ok: false, reason: 'no sim button', buttonCount: buttons.length };
    sim.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    sim.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    sim.click();
    return { ok: true, text: sim.textContent };
  });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
    const deadline = Date.now() + 60_000;
    let frames = 0;
    while (Date.now() < deadline) {
      frames = Number((await page.textContent('#streamFrames')) || '0');
      if (frames >= 1) break;
      await wait(400);
    }
    console.log('BOOT_FRAMES', frames);
    await wait(8000);
    await dumpProjected(page, 'before_sim');

    const click = await clickSimInProjected(page);
    console.log('SIM_CLICK', JSON.stringify(click));

    for (const sec of [2, 5, 10, 15]) {
      await wait(sec * 1000);
      await dumpProjected(page, `after_sim_${sec}s`);
    }
    const activity = await page.textContent('#activity');
    console.log('ACTIVITY_TAIL', (activity || '').slice(-3000));
  } finally {
    await page.click('#browseStop').catch(() => undefined);
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
