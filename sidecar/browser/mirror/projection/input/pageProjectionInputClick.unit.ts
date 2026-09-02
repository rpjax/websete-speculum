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
        inputPathTelemetry: true,
      }),
    );
    await session.navigate(url);
    const deadline = Date.now() + 30_000;
    while (frames < 1 && Date.now() < deadline) await wait(50);
    assert.ok(frames >= 1, 'expected projection frames before input');

    await wait(500);

    const status0 = await session.getStatus();
    const viewportW = status0.width;
    const viewportH = status0.height;

    const pushDom = session as unknown as {
      pushInput(input: {
        type: string;
        generation?: number;
        targetId: number | null;
        contextId: number;
        payloadJson: string;
      }): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }>;
      resolveAndClickDomInputByNodeId(
        selector: string,
        contextId?: number,
      ): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }>;
    };

    // Generation is journal-only — must not drop.
    const mismatchedGen = await pushDom.pushInput({
      type: 'mousedown',
      generation: 99_999,
      targetId: 1,
      contextId: 1,
      payloadJson: JSON.stringify({
        x: 1,
        y: 1,
        localX: 0.5,
        localY: 0.5,
        viewportW,
        viewportH,
        button: 0,
      }),
    });
    assert.strictEqual(mismatchedGen.status, 'dispatched', 'generation is journal-only');

    // Missing nodeId → reject async.
    consoleLines.length = 0;
    const noId = await pushDom.pushInput({
      type: 'mousedown',
      targetId: 0,
      contextId: 1,
      payloadJson: JSON.stringify({
        x: 1,
        y: 1,
        localX: 0.5,
        localY: 0.5,
        viewportW,
        viewportH,
        button: 0,
      }),
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

    // Invalid local % → reject (absolute stamp is not the hit criterion).
    consoleLines.length = 0;
    const badLocal = await pushDom.pushInput({
      type: 'mousedown',
      targetId: 1,
      contextId: 1,
      payloadJson: JSON.stringify({
        x: 1,
        y: 1,
        localX: 1.5,
        localY: 0.5,
        viewportW,
        viewportH,
        button: 0,
      }),
    });
    assert.strictEqual(badLocal.status, 'dispatched');
    const badLocalDeadline = Date.now() + 2_000;
    while (!consoleLines.some((l) => l.includes('invalid_local')) && Date.now() < badLocalDeadline) {
      await wait(20);
    }
    assert.ok(
      consoleLines.some((l) => l.includes('input_reject invalid_local validate')),
      `expected async invalid_local reject, got: ${consoleLines.join(' | ')}`,
    );

    // Lab helper: keyOfSelector + resolveNodeHit (omit/center local) → CDP → DOM effect.
    const clicked = await pushDom.resolveAndClickDomInputByNodeId('#click-me', 1);
    assert.strictEqual(clicked.status, 'dispatched', 'resolveAndClickDomInputByNodeId');

    await wait(300);

    // DOM is shared across Patchright worlds — attribute read is the effect oracle.
    const status = await session.evaluate(
      `document.getElementById('status')?.getAttribute('data-state') ?? ''`,
    );
    assert.ok(status.ok, status.errorMessage);
    assert.strictEqual(status.value, 'clicked', 'Virtual must reflect click via nodeId + local hit');
  } finally {
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log('[unit] PP input click nodeId+local ok');
}
