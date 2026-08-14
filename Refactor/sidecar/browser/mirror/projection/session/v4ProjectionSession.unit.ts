import assert from 'assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BrowserSessionEvents } from '../../../BrowserSession';
import { labAssetRoots } from '../lab/assetRoots';
import { createV4ProjectionBrowserSessionFactory } from './V4ProjectionBrowserSession';
import { v4LabLaunchOptions } from './v4LabLaunch';
import { LAB_TELEMETRY_DEFAULTS } from '../models/telemetry';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runV4ProjectionSessionUnitTests(): Promise<void> {
  if (process.env.SPECULUM_SKIP_V4_SESSION === '1') {
    console.log('[unit] V4ProjectionBrowserSession skipped (SPECULUM_SKIP_V4_SESSION=1)');
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
  const events: BrowserSessionEvents = {
    onVideoFrame: () => undefined,
    onAudioFrame: () => undefined,
    onPageProjectionDiff: () => {
      frames += 1;
    },
    onPageProjectionTelemetry: () => undefined,
    onConsole: () => undefined,
    onLocationChanged: () => undefined,
    onMainFrameNavigationBlocked: () => undefined,
    onEditableFocusChanged: () => undefined,
    onCameraPermissionRequested: async () => 'deny',
    onMicrophonePermissionRequested: async () => 'deny',
    onCrash: () => undefined,
  };

  const factory = createV4ProjectionBrowserSessionFactory({ headless: true });
  const session = factory.create('unit-v4', events);
  try {
    await session.launch(
      v4LabLaunchOptions({
        frameRateHz: 30,
        projectionTelemetry: { ...LAB_TELEMETRY_DEFAULTS },
        cpuProfiling: false,
      }),
    );
    await session.navigate(url);
    const deadline = Date.now() + 30_000;
    while (frames < 1 && Date.now() < deadline) await wait(50);
    assert.ok(frames >= 1, `expected at least one projection frame, got ${frames}`);

    const o2 = await session.flushProjectionSnapshot?.({ includeTree: false });
    assert.ok(o2?.ok && o2.o2, `coherent snapshot failed: ${o2?.reason}`);
    assert.strictEqual(o2.o2!.kind, 'table_live');
    assert.strictEqual(o2.o2!.identical, true, JSON.stringify(o2.o2!.divergences.slice(0, 3)));
    assert.ok(o2.table && o2.table.rowCount >= 0);
    assert.ok(typeof o2.table?.tableHash === 'string');
    assert.ok((o2.sequence ?? 0) >= 1);

    const resumed = await session.resumeProjectionWorld?.();
    assert.ok(resumed?.ok, resumed?.reason);

    const cpuDenied = await session.startCpuProfile?.();
    assert.ok(cpuDenied && cpuDenied.ok === false, 'cpuProfiling false must refuse CDP Profiler');
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] V4ProjectionBrowserSession frames+O2+halt/flush ok');
}
