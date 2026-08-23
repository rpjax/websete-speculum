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
      targetId: info.id,
      contextId: 1,
      payloadJson,
    };

    const pushDom = session as unknown as {
      pushInput(input: {
        type: string;
        generation: number;
        targetId: number;
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

    const noId = await pushDom.pushInput({
      ...base,
      type: 'mousedown',
      targetId: 0,
      payloadJson: JSON.stringify({ x: 0, y: 0, button: 0, buttons: 0, modifiers: {} }),
    });
    assert.strictEqual(noId.status, 'dropped');
    assert.strictEqual(noId.reason, 'node_id_required');

    const missing = await pushDom.pushInput({
      ...base,
      type: 'mousedown',
      targetId: 0x7fffffff,
      payloadJson: JSON.stringify({ x: 0, y: 0, button: 0, buttons: 0, modifiers: {} }),
    });
    assert.strictEqual(missing.status, 'dropped');
    assert.strictEqual(missing.reason, 'anchor_missing');

    // Wrong payload coords outside the box must still activate — id-assertive falls back to box center.
    const wrongCoordsPayload = JSON.stringify({
      x: 0,
      y: 0,
      button: 0,
      buttons: 0,
      modifiers: {},
    });
    for (const type of ['mousemove', 'mousedown', 'mouseup'] as const) {
      const out = await pushDom.pushInput({
        ...base,
        type,
        payloadJson: type === 'mousemove' ? wrongCoordsPayload : wrongCoordsPayload,
      });
      if (type === 'mousemove') {
        // Motion still needs finite coords — 0,0 is valid viewport edge.
        assert.strictEqual(out.status, 'dispatched', type);
      } else {
        assert.strictEqual(out.status, 'dispatched', `${type} id-primary despite wrong coords`);
      }
    }

    await wait(300);

    const status = await session.evaluate(
      `document.getElementById('status')?.getAttribute('data-state') ?? ''`,
    );
    assert.ok(status.ok, status.errorMessage);
    assert.strictEqual(status.value, 'clicked', 'Virtual must reflect click via nodeId');
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] PP input click id-assertive (no generation sync) ok');
}
