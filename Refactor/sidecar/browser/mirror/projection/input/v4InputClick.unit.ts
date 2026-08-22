import assert from 'assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BrowserSessionEvents } from '../../../BrowserSession';
import { labAssetRoots } from '../lab/assetRoots';
import { createV4ProjectionBrowserSessionFactory } from '../session/V4ProjectionBrowserSession';
import { v4LabLaunchOptions } from '../session/v4LabLaunch';
import { LAB_TELEMETRY_DEFAULTS } from '@speculum/page-projection/core/telemetry';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runV4InputClickUnitTests(): Promise<void> {
  if (process.env.SPECULUM_SKIP_V4_SESSION === '1') {
    console.log('[unit] V4 input click skipped (SPECULUM_SKIP_V4_SESSION=1)');
    return;
  }

  const { fixturesDir } = labAssetRoots();
  const fixture = path.join(fixturesDir, 'input-click.html');
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
  const session = factory.create('unit-v4-input', events);
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
    assert.ok(frames >= 1, 'expected projection frames before input');

    await wait(500);

    const resolved = await session.evaluate(
      `(() => {
        const p = globalThis.__speculumProjection;
        if (!p) return { ok: false, reason: 'producer' };
        const el = document.getElementById('click-me');
        if (!el) return { ok: false, reason: 'missing_button' };
        const id = p.domNodes.keyOf(el);
        const rect = el.getBoundingClientRect();
        return {
          ok: true,
          id,
          generation: p.domNodes.generation,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })()`,
    );
    assert.ok(resolved.ok, resolved.errorMessage);
    const info = JSON.parse(resolved.value ?? '{}') as {
      id: number;
      generation: number;
      x: number;
      y: number;
    };
    assert.ok(info.id > 0, 'button node id');

    const payloadJson = JSON.stringify({
      x: info.x,
      y: info.y,
      button: 0,
      buttons: 0,
      modifiers: {},
    });
    const base = {
      generation: info.generation,
      targetId: info.id,
      contextId: 1,
      payloadJson,
    };

    const stale = await session.pushDomInput!({
      ...base,
      type: 'mousedown',
      generation: info.generation + 99,
    });
    assert.strictEqual(stale.status, 'dropped');
    assert.strictEqual(stale.reason, 'generation_stale');

    for (const type of ['mousemove', 'mousedown', 'mouseup'] as const) {
      const out = await session.pushDomInput!({ ...base, type });
      assert.strictEqual(out.status, 'dispatched', type);
    }

    await wait(300);

    const status = await session.evaluate(
      `document.getElementById('status')?.getAttribute('data-state') ?? ''`,
    );
    assert.ok(status.ok, status.errorMessage);
    assert.strictEqual(status.value, 'clicked', 'Virtual must reflect click');
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] V4 input click + stale generation ok');
}
