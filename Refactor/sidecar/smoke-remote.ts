/**
 * Docker / local smoke helper notes are in README.
 * This script talks to an already-running sidecar (gRPC) using mock or Patchright.
 *
 * Usage:
 *   SPECULUM_SMOKE_TARGET=127.0.0.1:50051 npm run smoke:remote
 */

import * as grpc from '@grpc/grpc-js';
import { loadBrowserSessionPackage } from './grpc/loadProto';

async function unary(
  client: any,
  method: string,
  request: object,
  deadlineMs = 60_000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + deadlineMs);
    client[method](request, { deadline }, (err: Error | null, res: any) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

async function main(): Promise<void> {
  const target = process.env['SPECULUM_SMOKE_TARGET'] ?? '127.0.0.1:50051';
  const pkg = loadBrowserSessionPackage();
  const Client = pkg.speculum.sidecar.v1.BrowserSessionService;
  const client = new Client(target, grpc.credentials.createInsecure());

  try {
    const created = await unary(client, 'create', {});
    const sessionId = created.sessionId as string;
    console.log(`[smoke:remote] created ${sessionId}`);

    await unary(client, 'launch', { sessionId, width: 800, height: 600 }, 90_000);
    console.log('[smoke:remote] launched');

    await new Promise<void>((resolve, reject) => {
      const call = client.watchVideo({ sessionId });
      const timer = setTimeout(() => {
        call.cancel();
        reject(new Error('timeout waiting for video frame'));
      }, 30_000);
      call.on('data', (frame: { jpeg: Buffer }) => {
        clearTimeout(timer);
        console.log(`[smoke:remote] frame bytes=${frame.jpeg?.length ?? 0}`);
        call.cancel();
        resolve();
      });
      call.on('error', (err: Error) => {
        if ((err as { code?: number }).code === grpc.status.CANCELLED) return;
        clearTimeout(timer);
        reject(err);
      });
    });

    await unary(client, 'dispose', { sessionId });
    console.log('[smoke:remote] ok');
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error('[smoke:remote] failed', err);
  process.exit(1);
});
