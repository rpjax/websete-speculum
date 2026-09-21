#!/usr/bin/env node
/**
 * Lab Browse Beleza → grava frames WS → projected-replay → primeiro desync/applyFail.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const LAB = process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077/';
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_AFTER_NAV_MS = Number(process.env.WAIT_AFTER_NAV_MS || 60000);
const OUT = join(__dir, 'captures', `lab-replay-${Date.now()}`);
const telemetry = [];

const { chromium } = patchright;
mkdirSync(OUT, { recursive: true });

const binsB64Collected = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => {
  const t = msg.text();
  if (/desync|applyResult|precondition|sequence_gap/i.test(t)) telemetry.push(t);
});

await page.goto(LAB, { waitUntil: 'domcontentloaded', timeout: 60000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.webSocketFrameReceived', (params) => {
  const data = params.response?.payloadData;
  if (!data || params.response?.opcode !== 2) return;
  binsB64Collected.push(data);
});

await page.click('#connect');
await page.waitForFunction(
  () => {
    const disc = document.getElementById('browseDisconnect');
    return disc && !disc.disabled;
  },
  null,
  { timeout: 90000 },
);
await page.waitForFunction(() => !(document.getElementById('browseStart')?.disabled ?? true), null, {
  timeout: 15000,
});
await page.waitForTimeout(500);
await page.evaluate((url) => {
  const u = document.getElementById('url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, URL);
await page.click('button:has-text("Start Virtual")');
await page.waitForTimeout(8000);
const navBtn = page.locator('#browseNavigate');
if (await navBtn.isVisible().catch(() => false)) {
  await navBtn.click({ timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(WAIT_AFTER_NAV_MS);

const hud = await page.evaluate(() => ({
  build: document.body.innerText.match(/build #\d+/)?.[0],
  frames: document.getElementById('streamFrames')?.textContent,
  apply: document.getElementById('streamApply')?.textContent,
  desync: document.getElementById('streamDesync')?.textContent,
  activity: document.getElementById('activity')?.innerText?.slice(-3000),
}));

const binsB64 = binsB64Collected;
await browser.close();

for (let i = 0; i < binsB64.length; i++) {
  const raw = Buffer.from(binsB64[i], 'base64');
  writeFileSync(join(OUT, `f-${String(i + 1).padStart(4, '0')}.bin`), raw);
}
writeFileSync(join(OUT, 'MANIFEST.txt'), `url=${URL}\nlab=${LAB}\nhud=${JSON.stringify(hud)}\n`);

if (binsB64.length === 0) {
  console.log(JSON.stringify({ error: 'zero_frames', hud, OUT }, null, 2));
  process.exit(3);
}

const bundle = join(__dir, 'projected-replay.bundle.js');
if (!existsSync(bundle)) {
  execSync(
    `npx esbuild "${join(__dir, 'replay-entry.ts')}" --bundle --format=iife --global-name=SpeculumReplay --platform=browser --target=es2022 --outfile="${bundle}"`,
    { stdio: 'inherit', cwd: join(__dir, '../..') },
  );
}

const rb = await chromium.launch({ headless: true });
const rp = await rb.newPage();
await rp.goto('about:blank');
await rp.evaluate((code) => {
  eval(code);
}, readFileSync(bundle, 'utf8'));
const replay = await rp.evaluate(async (frames) => {
  const fn = window.__speculumReplayFrames ?? window.SpeculumReplay?.replayFrames;
  return fn(frames);
}, binsB64);
await rb.close();

const firstDesync = replay.errors?.[0] ?? null;
const firstApplyFail = replay.errors?.find((e) => e.kind === 'applyResult' && e.ok === false) ?? null;

console.log(
  JSON.stringify(
    {
      OUT,
      hud,
      captured: binsB64.length,
      replay,
      diagnosis: {
        firstDesync,
        firstErrorCode: firstDesync?.errorCode ?? firstDesync?.reason ?? replay.applyError,
        firstSequence: firstDesync?.sequence ?? replay.lastSeq,
        firstOp: firstDesync?.op,
        firstMessage: firstDesync?.message,
      },
    },
    null,
    2,
  ),
);

process.exit(replay.desynced || replay.applyFail > 0 ? 2 : replay.applyOk === binsB64.length ? 0 : 1);
