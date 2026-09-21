#!/usr/bin/env node
/** Replay só bins que decodificam como frame PP (ctx>=1). */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import patchright from '../../sidecar/node_modules/patchright/index.js';
import { decodeFramePart, PersistentStringTable } from '../../packages/page-projection/dist/core/decode.js';

const cap = process.argv[2];
if (!cap) {
  console.error('uso: replay-pp-only.mjs <dir>');
  process.exit(2);
}

const __dir = dirname(fileURLToPath(import.meta.url));
const persistent = new PersistentStringTable();
const files = readdirSync(cap)
  .filter((f) => f.endsWith('.bin'))
  .sort();
const pp = [];
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(join(cap, f)));
  const dec = decodeFramePart(bytes, persistent);
  if (dec.ok && dec.part.contextId >= 1) {
    pp.push({ file: f, part: dec.part, b64: readFileSync(join(cap, f)).toString('base64') });
  }
}

const bundle = join(__dir, 'projected-replay.bundle.js');
if (!existsSync(bundle)) {
  execSync(
    `npx esbuild "${join(__dir, 'replay-entry.ts')}" --bundle --format=iife --global-name=SpeculumReplay --platform=browser --target=es2022 --outfile="${bundle}"`,
    { stdio: 'inherit', cwd: join(__dir, '../..') },
  );
}

const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
await page.evaluate((code) => {
  eval(code);
}, readFileSync(bundle, 'utf8'));
const replay = await page.evaluate(async (frames) => {
  const fn = window.__speculumReplayFrames ?? window.SpeculumReplay?.replayFrames;
  return fn(frames);
}, pp.map((p) => p.b64));
await browser.close();

console.log(
  JSON.stringify(
    {
      capture: cap,
      ppFrames: pp.map((p) => ({
        file: p.file,
        ctx: p.part.contextId,
        seq: p.part.sequence,
        resync: p.part.resync,
        ops: p.part.ops.length,
      })),
      replay,
      firstDesync: replay.errors?.[0] ?? null,
    },
    null,
    2,
  ),
);

process.exit(replay.desynced ? 2 : replay.applyOk === pp.length ? 0 : 1);
