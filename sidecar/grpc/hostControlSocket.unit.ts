/**
 * M8 — host control stream + one gRPC channel per session (I8).
 * K3 density target: 100 concurrent session sockets (PP-DEN-1 / motor-migration M8).
 */

import assert from 'assert';
import * as grpc from '@grpc/grpc-js';
import { createMockBrowserSessionFactory } from '../browser/MockBrowserSession';
import { bindAndStart, createSidecarServer } from '../index';
import { loadBrowserSessionPackage } from './loadProto';

/** K3 / PP-DEN-1 concurrent session target. */
export const M8_DENSITY_SESSION_COUNT = 100;

type BrowserSessionClient = grpc.Client & Record<string, (...args: unknown[]) => unknown>;

function createClient(target: string): BrowserSessionClient {
  const pkg = loadBrowserSessionPackage();
  const Client = pkg.speculum.sidecar.v1.BrowserSessionService;
  return new Client(target, grpc.credentials.createInsecure()) as BrowserSessionClient;
}

function unary<T>(
  client: BrowserSessionClient,
  method: string,
  request: object,
  deadlineMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + deadlineMs);
    (client[method] as (req: object, opts: object, cb: (err: Error | null, res: T) => void) => void)(
      request,
      { deadline },
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      },
    );
  });
}

function openHostControl(target: string): {
  client: BrowserSessionClient;
  call: grpc.ClientDuplexStream<unknown, unknown>;
} {
  const client = createClient(target);
  const metadata = new grpc.Metadata();
  const call = client.hostControl(metadata) as grpc.ClientDuplexStream<unknown, unknown>;
  return { client, call };
}

function hostPing(
  call: grpc.ClientDuplexStream<unknown, unknown>,
  seq: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('host control ping timeout')), 5_000);
    const onData = (msg: { ackSeq?: number | string; ack_seq?: number | string }): void => {
      clearTimeout(timer);
      call.removeListener('data', onData);
      const ack = Number(msg.ackSeq ?? msg.ack_seq ?? -1);
      resolve(ack);
    };
    call.on('data', onData);
    call.write({ pingSeq: seq });
  });
}

export async function runHostControlSocketUnitTests(): Promise<void> {
  process.env['SPECULUM_BROWSER'] = 'mock';
  const factory = createMockBrowserSessionFactory({ emitFrames: false, frameIntervalMs: 100 });
  const { server } = createSidecarServer({
    emitFrames: false,
    frameIntervalMs: 100,
    factory,
  });
  const addr = await bindAndStart(server, '127.0.0.1:0');
  const target = addr.replace('0.0.0.0', '127.0.0.1');

  const { client: hostClient, call: hostCall } = openHostControl(target);
  hostCall.on('error', () => {
    /* shutdown / forceShutdown may cancel the duplex */
  });
  try {
    const ack0 = await hostPing(hostCall, 1);
    assert.strictEqual(ack0, 1, 'host control must echo ping_seq');

    // I8: server rejects HostControl when x-session-id metadata is present (see BrowserSessionService.ts).
    const liveSessionIds: string[] = [];

    for (let i = 0; i < M8_DENSITY_SESSION_COUNT; i++) {
      const sessionClient = createClient(target);
      const created = await unary<{ sessionId: string }>(sessionClient, 'create', {});
      const sessionId = created.sessionId;
      liveSessionIds.push(sessionId);

      const status = await unary<{ isOpen: boolean }>(sessionClient, 'getStatus', { sessionId });
      assert.strictEqual(status.isOpen, false, 'created session should not be launched yet');

      sessionClient.close();
    }

    const ackAfterDensity = await hostPing(hostCall, 2);
    assert.strictEqual(ackAfterDensity, 2, 'host control must survive session churn');

    for (const sessionId of liveSessionIds) {
      const disposeClient = createClient(target);
      await unary(disposeClient, 'dispose', { sessionId });
      disposeClient.close();
    }

    const ackAfterDispose = await hostPing(hostCall, 3);
    assert.strictEqual(ackAfterDispose, 3, 'host control must survive session dispose');
  } finally {
    hostCall.end();
    hostClient.close();
    server.forceShutdown();
  }

  console.log(`[unit] hostControlSocket: ${M8_DENSITY_SESSION_COUNT} session sockets ok`);
}
