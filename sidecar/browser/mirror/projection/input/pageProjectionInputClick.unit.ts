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
  if (!process.env['CHROME_EXECUTABLE']?.trim()) {
    console.log('[unit] PP input click skipped (no CHROME_EXECUTABLE)');
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
  const consoleLines: string[] = [];
  const events: BrowserSessionEvents = {
    onVideoFrame: () => undefined,
    onAudioFrame: () => undefined,
    onPageProjectionFrame: () => {
      frames += 1;
    },
    onPageProjectionTelemetry: () => undefined,
    // EventApplier rejects land here as `input_reject <errorCode> <phase>` (PageProjectionBrowserSession
    // launch() wiring) — pushInput itself no longer returns a synchronous drop for these.
    onConsole: (_level, text) => {
      consoleLines.push(text);
    },
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

    // EventApplier.validatePointer (browser/input/EventApplier.ts) drops on any viewport stamp
    // mismatch before it even looks at coords — stamp every ingress with the session's live size.
    const status0 = await session.getStatus();
    const viewportW = status0.width;
    const viewportH = status0.height;

    const payloadJson = JSON.stringify({
      x: info.x,
      y: info.y,
      viewportW,
      viewportH,
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

    // Missing nodeId → dispatched at ingress, rejected async by EventApplier.
    consoleLines.length = 0;
    const noId = await pushDom.pushInput({
      ...base,
      type: 'mousedown',
      targetId: 0,
      payloadJson: JSON.stringify({ x: info.x, y: info.y, viewportW, viewportH, button: 0, buttons: 0, modifiers: {} }),
    });
    assert.strictEqual(noId.status, 'dispatched');
    const noIdDeadline = Date.now() + 2_000;
    while (!consoleLines.some((l) => l.includes('missing_node_id')) && Date.now() < noIdDeadline) {
      await wait(20);
    }
    assert.ok(
      consoleLines.some((l) => l.includes('input_reject missing_node_id validate')),
      `expected async missing_node_id reject, got: ${consoleLines.join(' | ')}`,
    );

    // Coord validation is downstream in EventApplier now — ingressToUnifiedIntent/pushInput
    // always report 'dispatched'; an out-of-viewport point rejects asynchronously via onReject
    // (PageProjectionBrowserSession launch() logs it as `input_reject <errorCode> <phase>`).
    consoleLines.length = 0;
    const badCoords = await pushDom.pushInput({
      ...base,
      type: 'mousedown',
      payloadJson: JSON.stringify({ x: viewportW + 100, y: 0, viewportW, viewportH, button: 0, buttons: 0, modifiers: {} }),
    });
    assert.strictEqual(badCoords.status, 'dispatched');
    const badCoordsDeadline = Date.now() + 2_000;
    while (!consoleLines.some((l) => l.includes('invalid_coords')) && Date.now() < badCoordsDeadline) {
      await wait(20);
    }
    assert.ok(
      consoleLines.some((l) => l.includes('input_reject invalid_coords validate')),
      `expected async invalid_coords reject, got: ${consoleLines.join(' | ')}`,
    );

    // Id-addressed click via nodeId → resolveNodeHit → CDP at live center.
    for (const type of ['mousedown', 'mouseup'] as const) {
      const out = await pushDom.pushInput({ ...base, type });
      assert.strictEqual(out.status, 'dispatched', type);
    }

    await wait(300);

    const status = await session.evaluate(
      `document.getElementById('status')?.getAttribute('data-state') ?? ''`,
    );
    assert.ok(status.ok, status.errorMessage);
    assert.strictEqual(status.value, 'clicked', 'Virtual must reflect click via nodeId resolve');
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] PP input click nodeId-addressed ok');
}
