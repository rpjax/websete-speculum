import assert from 'assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BrowserSessionEvents } from '../../../BrowserSession';
import { labAssetRoots } from '../lab/assetRoots';
import { createPageProjectionBrowserSessionFactory } from './PageProjectionBrowserSession';
import { labLaunchOptions } from './labLaunch';
import { LAB_TELEMETRY_DEFAULTS } from '@speculum/page-projection/core/telemetry';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function emptyEvents(): BrowserSessionEvents {
  return {
    onVideoFrame: () => undefined,
    onAudioFrame: () => undefined,
    onPageProjectionFrame: () => undefined,
    onPageProjectionTelemetry: () => undefined,
    onConsole: () => undefined,
    onLocationChanged: () => undefined,
    onMainFrameNavigationBlocked: () => undefined,
    onEditableFocusChanged: () => undefined,
    onCameraPermissionRequested: async () => 'deny',
    onMicrophonePermissionRequested: async () => 'deny',
    onCrash: () => undefined,
  };
}

export async function runPageProjectionSessionUnitTests(): Promise<void> {
  if (process.env.SPECULUM_SKIP_PP_SESSION === '1') {
    console.log('[unit] PageProjectionBrowserSession skipped (SPECULUM_SKIP_PP_SESSION=1)');
    return;
  }

  let uinputOk = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uinputOk = require('../../../input/os/uinput').uinputAvailable() === true;
  } catch {
    uinputOk = false;
  }
  if (!uinputOk) {
    console.log('[unit] PageProjectionBrowserSession skipped (no /dev/uinput — OS input fail-closed)');
    return;
  }

  const { fixturesDir } = labAssetRoots();
  const fixture = path.join(fixturesDir, 'insert-before-remove.html');
  assert.ok(fs.existsSync(fixture), `missing fixture ${fixture}`);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(fixture).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  const url = `http://127.0.0.1:${addr.port}/`;

  let frames = 0;
  const events = emptyEvents();
  events.onPageProjectionFrame = () => {
    frames += 1;
  };

  const factory = createPageProjectionBrowserSessionFactory({ headless: true });
  const session = factory.create('unit-pp', events);
  try {
    await session.launch(
      labLaunchOptions({
        frameRateHz: 30,
        projectionTelemetry: { ...LAB_TELEMETRY_DEFAULTS },
        cpuProfiling: false,
      }),
    );
    await session.navigate(url);
    const deadline = Date.now() + 30_000;
    while (frames < 1 && Date.now() < deadline) await wait(50);
    assert.ok(frames >= 1, `expected at least one projection frame, got ${frames}`);

    const snap = await session.getStateSnapshot?.(1, { table: 'full', tree: false });
    assert.ok(snap?.ok, `coherent snapshot failed: ${snap && !snap.ok ? snap.reason : 'unknown'}`);
    const rows = snap!.table && typeof snap!.table === 'object' && 'rows' in (snap!.table as object)
      ? (snap!.table as { rows: { kind?: string; identical?: boolean; divergences?: unknown[] }; digest: { rowCount: number; tableHash: string } }).rows
      : null;
    const digest = snap!.table && typeof snap!.table === 'object' && 'digest' in (snap!.table as object)
      ? (snap!.table as { digest: { rowCount: number; tableHash: string } }).digest
      : (snap!.table as { rowCount: number; tableHash: string });
    assert.ok(rows, 'expected table rows (o2)');
    assert.strictEqual(rows!.kind, 'table_live');
    assert.strictEqual(rows!.identical, true, JSON.stringify((rows!.divergences ?? []).slice(0, 3)));
    assert.ok(digest && digest.rowCount >= 0);
    assert.ok(typeof digest.tableHash === 'string');
    assert.ok((snap!.sequence ?? 0) >= 1);

    const resumed = await session.resumeClocks?.();
    assert.ok(resumed?.ok, resumed?.reason);

    const cpuDenied = await session.startCpuProfile?.();
    assert.ok(cpuDenied && cpuDenied.ok === false, 'cpuProfiling false must refuse CDP Profiler');
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] PageProjectionBrowserSession frames+O2+halt/flush ok');

  await runDocumentCspHookUnitTests();
}

/** Response-stage Document hook: meta CSP relaxed; nonce stripped; other directives preserved. */
async function runDocumentCspHookUnitTests(): Promise<void> {
  const policy =
    "script-src 'nonce-test' 'strict-dynamic'; connect-src 'none'; img-src https:";
  const html = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${policy}">
<title>csp-hook</title></head><body><p id="ok">ok</p></body></html>`;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': policy,
    });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  const url = `http://127.0.0.1:${addr.port}/`;

  const factory = createPageProjectionBrowserSessionFactory({ headless: true });
  const session = factory.create('unit-pp-csp', emptyEvents());
  try {
    await session.launch(
      labLaunchOptions({
        frameRateHz: 10,
        projectionTelemetry: { ...LAB_TELEMETRY_DEFAULTS },
        cpuProfiling: false,
      }),
    );
    await session.navigate(url);
    const meta = await session.evaluate(
      `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`,
    );
    assert.ok(meta.ok, meta.errorMessage);
    const content = meta.value;
    assert.ok(!content.includes("'nonce-test'"), `nonce stripped: ${content}`);
    assert.ok(!content.includes("'strict-dynamic'"), `strict-dynamic stripped: ${content}`);
    assert.ok(content.includes('img-src https:'), `preserved img-src: ${content}`);
    assert.ok(/connect-src[^;]*\*/.test(content), `connect-src widened: ${content}`);
    assert.ok(content.includes("'unsafe-inline'"), `inline script enabled: ${content}`);
    assert.ok(/\bscript-src[^;]*\*/.test(content), `script * compensation: ${content}`);
    assert.ok(/\bscript-src[^;]*blob:/.test(content), `script blob: compensation: ${content}`);
    assert.ok(/\bscript-src[^;]*data:/.test(content), `script data: compensation: ${content}`);
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] V4 Document Response CSP hook ok');
}
