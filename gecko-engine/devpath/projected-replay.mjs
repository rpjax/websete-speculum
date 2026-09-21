#!/usr/bin/env node
/** Replay capture bins through real ProjectionClient (Chromium). */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const cap = process.argv[2];
if (!cap) {
  console.error('uso: projected-replay.mjs <capture-dir>');
  process.exit(2);
}

const bundle = join(__dir, 'projected-replay.bundle.js');
if (!existsSync(bundle)) {
  execSync(
    `npx esbuild "${join(__dir, 'replay-entry.ts')}" --bundle --format=iife --global-name=SpeculumReplay --platform=browser --target=es2022 --outfile="${bundle}"`,
    { stdio: 'inherit', cwd: join(__dir, '../..'), env: { ...process.env } },
  );
}

const files = readdirSync(cap)
  .filter((f) => /^f-\d+.*\.bin$/.test(f))
  .sort();
const framesB64 = files.map((f) => readFileSync(join(cap, f)).toString('base64'));

const browser = await patchright.chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
const bundleSrc = readFileSync(bundle, 'utf8');
await page.evaluate((code) => {
  eval(code);
}, bundleSrc);
const result = await page.evaluate(async (frames) => {
  const fn = window.__speculumReplayFrames ?? window.SpeculumReplay?.replayFrames;
  if (typeof fn !== 'function') throw new Error('replay export missing');
  return fn(frames);
}, framesB64);
console.log(JSON.stringify({ capture: cap, frameCount: files.length, result }, null, 2));
await browser.close();
const ok =
  !result.desynced
  && result.applyOk === files.length
  && result.ingested === files.length
  && result.applyFail === 0;
process.exit(ok ? 0 : 2);
