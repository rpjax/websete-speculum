#!/usr/bin/env node
/**
 * Abre o lab Gecko, Browse Beleza, coleta telemetria desync do WebSocket (client.telemetry).
 * Uso: node gecko-engine/devpath/lab-desync-probe.mjs [url]
 */
import patchright from '../../sidecar/node_modules/patchright/index.js';
const { chromium } = patchright;

const LAB = process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077/';
const TARGET = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 45000);

const desyncs = [];
const applyResults = [];
const misc = [];

const page = await chromium.launch({ headless: true }).then((b) => b.newPage());
page.on('console', (msg) => {
  const t = msg.text();
  if (/desync|projected blank|preTableHash|sequence_gap|apply_gate/i.test(t)) {
    misc.push(t);
  }
});

await page.setViewportSize({ width: 1400, height: 900 });
await page.goto(LAB, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.exposeFunction('__probeTelemetry', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  const m = msg.message ?? msg;
  if (m.kind === 'desynced' || m.kind === 'desync') {
    desyncs.push({
      t: Date.now(),
      errorCode: m.errorCode,
      phase: m.phase,
      contextId: m.contextId,
      sequence: m.sequence,
      generation: m.generation,
      message: m.message,
    });
  }
  if (m.kind === 'applyResult') {
    applyResults.push({
      ok: m.ok,
      sequence: m.sequence,
      generation: m.generation,
      reason: m.reason,
      contextId: m.contextId,
    });
  }
});

await page.evaluate(() => {
  const orig = WebSocket.prototype.send;
  WebSocket.prototype.send = function patchedSend(data) {
    if (typeof data === 'string' && data.includes('client.telemetry')) {
      try {
        const j = JSON.parse(data);
        if (j.type === 'client.telemetry' && j.message) {
          window.__probeTelemetry(j);
        }
      } catch {
        /* */
      }
    }
    return orig.call(this, data);
  };
});

await page.click('button:has-text("Connect")');
await page.waitForTimeout(2000);
await page.evaluate((url) => {
  const u = document.getElementById('url');
  if (!u) throw new Error('no #url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, TARGET);
await page.click('button:has-text("Start Virtual")');
// Same lab as manual: optional in-site navigate beat after Virtual is live.
await page.waitForTimeout(8000);
const navBtn = page.locator('#browseNavigate');
if (await navBtn.isVisible().catch(() => false) && (await navBtn.isEnabled().catch(() => false))) {
  await navBtn.click({ timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(Math.max(0, WAIT_MS - 8000));

const hud = await page.evaluate(() => ({
  frames: document.getElementById('streamFrames')?.textContent,
  apply: document.getElementById('streamApply')?.textContent,
  desync: document.getElementById('streamDesync')?.textContent,
  resync: document.getElementById('streamResync')?.textContent,
  seq: document.getElementById('streamSeq')?.textContent,
  gen: document.getElementById('streamGen')?.textContent,
  build: document.body.innerText.match(/build #\d+/)?.[0],
  activity: document.getElementById('activity')?.innerText?.slice(-4000),
  bodyLen:
    document.querySelector('[data-pp-surface-stage] iframe')?.contentDocument?.body?.innerHTML
      ?.length ?? 0,
}));

const applyOk = applyResults.filter((r) => r.ok).length;
const applyFail = applyResults.filter((r) => !r.ok).length;
const wire = Number(hud.frames ?? 0);
const applyHud = Number(hud.apply ?? 0);
const summary = { wire, applyHud, applyOkTelemetry: applyOk, applyFailTelemetry: applyFail, desyncCount: desyncs.length };
console.log(JSON.stringify({ summary, hud, desyncs, applyResults, misc }, null, 2));
await page.close();
const broken = wire > 5 && (applyHud < wire * 0.8 || desyncs.length > 0);
process.exit(broken ? 2 : wire > 0 && applyHud >= wire * 0.8 ? 0 : 1);
