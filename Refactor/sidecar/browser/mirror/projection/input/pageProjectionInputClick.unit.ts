import assert from 'assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BrowserSessionEvents } from '../../../BrowserSession';
import { labAssetRoots } from '../lab/assetRoots';
import { createPageProjectionBrowserSessionFactory } from '../session/PageProjectionBrowserSession';
import { labLaunchOptions } from '../session/labLaunch';
import { LAB_TELEMETRY_DEFAULTS } from '@speculum/page-projection/core/telemetry';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runPageProjectionInputClickUnitTests(): Promise<void> {
  if (process.env.SPECULUM_SKIP_PP_SESSION === '1') {
    console.log('[unit] PP input click skipped (SPECULUM_SKIP_PP_SESSION=1)');
    return;
  }
  let uinputOk = false;
  try {
    uinputOk = require('../../../patchright/input/uinput').uinputAvailable() === true;
  } catch {
    uinputOk = false;
  }
  if (!uinputOk) {
    console.log('[unit] PP input click skipped (no /dev/uinput)');
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
    onPageProjectionFrame: () => {
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

  const factory = createPageProjectionBrowserSessionFactory({ headless: true });
  const session = factory.create('unit-pp-input', events);
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
      targetId: null as number | null,
      contextId: 1,
      payloadJson,
    };

    const pushDom = session as unknown as {
      pushInput(input: {
        type: string;
        generation: number;
        targetId: number | null;
        contextId: number;
        payloadJson: string;
      }): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }>;
    };
    // Wrong generation must NOT drop — input has no sync with frame generation.
    const mismatchedGen = await pushDom.pushInput({
      ...base,
      type: 'mousedown',
      generation: info.generation + 99,
    });
    assert.strictEqual(mismatchedGen.status, 'dispatched', 'generation is journal-only');

    // Mode A: missing nodeId is fine (journal-only); invalid coords still drop.
    const noIdOk = await pushDom.pushInput({
      ...base,
      type: 'mousedown',
      targetId: 0,
      payloadJson: JSON.stringify({ x: info.x, y: info.y, button: 0, buttons: 0, modifiers: {} }),
    });
    assert.strictEqual(noIdOk.status, 'dispatched', 'Mode A ignores nodeId');

    const badCoords = await pushDom.pushInput({
      ...base,
      type: 'mousedown',
      payloadJson: JSON.stringify({ y: 0, button: 0, buttons: 0, modifiers: {} }),
    });
    assert.strictEqual(badCoords.status, 'dropped');
    assert.strictEqual(badCoords.reason, 'invalid_coords');

    // Mode B still requires nodeId.
    const scrollNoId = await pushDom.pushInput({
      type: 'scrollElement',
      generation: info.generation,
      targetId: 0,
      contextId: 1,
      payloadJson: JSON.stringify({ scrollTop: 10, scrollLeft: 0 }),
    });
    assert.strictEqual(scrollNoId.status, 'dropped');
    assert.strictEqual(scrollNoId.reason, 'node_id_required');

    // Activate at button center via Mode A coords (no resolve).
    for (const type of ['mousemove', 'mousedown', 'mouseup'] as const) {
      const out = await pushDom.pushInput({ ...base, type });
      assert.strictEqual(out.status, 'dispatched', type);
    }

    await wait(300);

    const status = await session.evaluate(
      `document.getElementById('status')?.getAttribute('data-state') ?? ''`,
    );
    assert.ok(status.ok, status.errorMessage);
    assert.strictEqual(status.value, 'clicked', 'Virtual must reflect click via Mode A CDP coords');
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] PP input click Mode A coords (no resolve) ok');
}
