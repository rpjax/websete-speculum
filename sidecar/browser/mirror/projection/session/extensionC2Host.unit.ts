/**
 * Extension C2 — SessionConfig push requires ACK before navigate (runtime-redesign.md §0 #3).
 * Also proves per-session extension dirs isolate c2-endpoint.json (B1).
 */

import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import {
  materializeSpeculumPpForSession,
  removeSpeculumPpSessionDir,
} from '../../../patchright/ChromeRuntime';
import { ExtensionC2Host, EXTENSION_C2_CHANNEL } from './extensionC2Host';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runExtensionC2HostUnitTests(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speculum-c2-'));
  const host = new ExtensionC2Host({ extensionDir: dir, ackTimeoutMs: 2_000 });
  try {
    const url = await host.listen();
    assert.ok(url.startsWith('ws://127.0.0.1:'));
    const endpoint = JSON.parse(fs.readFileSync(path.join(dir, 'c2-endpoint.json'), 'utf8')) as {
      url: string;
    };
    assert.strictEqual(endpoint.url, url);

    // Navigate-without-ACK must fail closed when SW is not connected.
    let failed = false;
    try {
      await host.pushSessionConfig({
        sessionId: 's1',
        dataPlaneUrl: 'ws://127.0.0.1:9/',
        planeBridgeToken: 'tok',
      });
    } catch (err) {
      failed = true;
      assert.strictEqual(
        (err as { errorCode?: string }).errorCode,
        'extension_c2_not_connected',
      );
    }
    assert.strictEqual(failed, true, 'push without SW must fail');

    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    await host.waitConnected(2_000);

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as {
        channel?: string;
        kind?: string;
        config?: { sessionId?: string };
      };
      if (msg.channel !== EXTENSION_C2_CHANNEL || msg.kind !== 'SessionConfig') return;
      ws.send(
        JSON.stringify({
          channel: EXTENSION_C2_CHANNEL,
          kind: 'SessionConfigAck',
          ok: true,
          sessionId: msg.config?.sessionId ?? null,
        }),
      );
    });

    await host.pushSessionConfig({
      sessionId: 's1',
      dataPlaneUrl: 'ws://127.0.0.1:9/',
      planeBridgeToken: 'tok',
      transport: 'loopback',
      loopbackCarrier: 'extension',
    });

    // NACK path
    ws.removeAllListeners('message');
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { kind?: string };
      if (msg.kind !== 'SessionConfig') return;
      ws.send(
        JSON.stringify({
          channel: EXTENSION_C2_CHANNEL,
          kind: 'SessionConfigAck',
          ok: false,
          reason: 'invalid_config',
        }),
      );
    });
    let nack = false;
    try {
      await host.pushSessionConfig({
        sessionId: 's2',
        dataPlaneUrl: 'ws://127.0.0.1:9/',
        planeBridgeToken: 'tok',
      });
    } catch (err) {
      nack = true;
      assert.strictEqual((err as { errorCode?: string }).errorCode, 'extension_c2_nack');
    }
    assert.strictEqual(nack, true);
    ws.close();
    await wait(20);
  } finally {
    await host.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // B1: two concurrent materializations must not share c2-endpoint.json.
  const a = materializeSpeculumPpForSession(`unit-c2-a-${Date.now()}`);
  const b = materializeSpeculumPpForSession(`unit-c2-b-${Date.now()}`);
  try {
    assert.notStrictEqual(a, b);
    const hostA = new ExtensionC2Host({ extensionDir: a });
    const hostB = new ExtensionC2Host({ extensionDir: b });
    const urlA = await hostA.listen();
    const urlB = await hostB.listen();
    assert.notStrictEqual(urlA, urlB);
    const epA = JSON.parse(fs.readFileSync(path.join(a, 'c2-endpoint.json'), 'utf8')) as { url: string };
    const epB = JSON.parse(fs.readFileSync(path.join(b, 'c2-endpoint.json'), 'utf8')) as { url: string };
    assert.strictEqual(epA.url, urlA);
    assert.strictEqual(epB.url, urlB);
    assert.notStrictEqual(epA.url, epB.url);
    await hostA.close();
    await hostB.close();
  } finally {
    removeSpeculumPpSessionDir(a);
    removeSpeculumPpSessionDir(b);
  }

  console.log('[unit] extensionC2Host ok');
}
