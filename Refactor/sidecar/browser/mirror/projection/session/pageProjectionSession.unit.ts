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
  if (!process.env['CHROME_EXECUTABLE']?.trim()) {
    console.log('[unit] PageProjectionBrowserSession skipped (no CHROME_EXECUTABLE)');
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
  await runSingleTabLocaleCspPlaneUnitTests();
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

/**
 * Locale-popup stand-in: target=_blank / window.open must land on primary tab with
 * CSP connect-src widened and loopback data plane open (Binance-class defect).
 */
async function runSingleTabLocaleCspPlaneUnitTests(): Promise<void> {
  const policy =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.binance.com; img-src 'self' https:";
  const en = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${policy}">
<title>EN</title></head><body>
<h1 id="title">EN</h1>
<a id="go-br-blank" href="/br" target="_blank" rel="noopener">BR</a>
</body></html>`;
  const br = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${policy}">
<title>BR</title></head><body>
<h1 id="title">BR</h1>
<p id="landed">ok</p>
</body></html>`;

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': policy,
      'Cache-Control': 'no-store',
    };
    if (pathname === '/' || pathname === '/en') {
      res.writeHead(200, headers);
      res.end(en);
      return;
    }
    if (pathname === '/br') {
      res.writeHead(200, headers);
      res.end(br);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${addr.port}`;

  const factory = createPageProjectionBrowserSessionFactory({ headless: true });
  const session = factory.create('unit-pp-single-tab-csp', emptyEvents()) as ReturnType<
    ReturnType<typeof createPageProjectionBrowserSessionFactory>['create']
  > & {
    measureApplyScrollSet: (args: {
      contextId: number;
      nodeId: number | null;
      scrollX: number;
      scrollY: number;
    }) => Promise<{ ok: boolean; error?: string; wallMs: number }>;
  };
  try {
    await session.launch(
      labLaunchOptions({
        frameRateHz: 10,
        projectionTelemetry: { ...LAB_TELEMETRY_DEFAULTS },
        cpuProfiling: false,
      }),
    );
    await session.navigate(`${origin}/en`);
    await wait(600);

    const click = await session.evaluate(`(() => {
      const a = document.getElementById('go-br-blank');
      if (!a) throw new Error('missing #go-br-blank');
      a.click();
      return 'clicked';
    })()`);
    assert.ok(click.ok, click.errorMessage);

    const deadline = Date.now() + 15_000;
    let title = '';
    while (Date.now() < deadline) {
      const t = await session.evaluate(`document.getElementById('title')?.textContent ?? ''`);
      title = t.value ?? '';
      if (title === 'BR') break;
      await wait(100);
    }
    assert.strictEqual(title, 'BR', 'target=_blank must fold into primary tab (single-tab)');

    const meta = await session.evaluate(
      `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`,
    );
    assert.ok(meta.ok, meta.errorMessage);
    assert.ok(
      /\bconnect-src\b[^;]*\*/.test(meta.value) || /\bconnect-src\b[^;]*\bws:/.test(meta.value),
      `connect-src widened after popup nav: ${meta.value}`,
    );

    const planeDeadline = Date.now() + 10_000;
    let planeOk = false;
    let lastErr = '';
    while (Date.now() < planeDeadline) {
      const lastPlane = await session.measureApplyScrollSet({
        contextId: 1,
        nodeId: null,
        scrollX: 0,
        scrollY: 1,
      });
      if (lastPlane.ok) {
        planeOk = true;
        break;
      }
      lastErr = lastPlane.error ?? '';
      if (lastErr && !/data plane not open|not_open/i.test(lastErr)) {
        planeOk = true;
        break;
      }
      await wait(100);
    }
    assert.ok(planeOk, `data plane must reopen after locale popup nav: ${lastErr}`);
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] single-tab locale CSP + data plane ok');
}
