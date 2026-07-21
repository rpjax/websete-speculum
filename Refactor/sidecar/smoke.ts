/**
 * Smoke: Create → Launch → WatchVideo (receive ≥1 frame) while GetStatus succeeds in parallel.
 */

import * as grpc from '@grpc/grpc-js';
import { createSidecarServer, bindAndStart } from './index';
import { loadBrowserSessionPackage } from './grpc/loadProto';

async function unary(
  client: any,
  method: string,
  request: object,
  deadlineMs = 5_000,
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
  // Force mock so smoke does not require Chrome/Xvfb.
  process.env['SPECULUM_BROWSER'] = 'mock';
  const { server } = createSidecarServer({ frameIntervalMs: 100 });
  const addr = await bindAndStart(server, '127.0.0.1:0');
  const target = addr.replace('0.0.0.0', '127.0.0.1');

  const pkg = loadBrowserSessionPackage();
  const Client = pkg.speculum.sidecar.v1.BrowserSessionService;
  const client = new Client(target, grpc.credentials.createInsecure());

  try {
    const created = await unary(client, 'create', {});
    const sessionId = created.sessionId as string;
    console.log(`[smoke] created session ${sessionId}`);

    await unary(client, 'launch', {
      sessionId,
      width: 800,
      height: 600,
    });
    console.log('[smoke] launched');

    const framePromise = new Promise<void>((resolve, reject) => {
      const call = client.watchVideo({ sessionId });
      const timer = setTimeout(() => {
        call.cancel();
        reject(new Error('timeout waiting for video frame'));
      }, 5_000);
      call.on('data', (frame: { jpeg: Buffer }) => {
        clearTimeout(timer);
        console.log(`[smoke] video frame bytes=${frame.jpeg?.length ?? 0}`);
        call.cancel();
        resolve();
      });
      call.on('error', (err: Error) => {
        if ((err as { code?: number }).code === grpc.status.CANCELLED) return;
        clearTimeout(timer);
        reject(err);
      });
    });

    const statusPromise = (async () => {
      // Parallel unaries while WatchVideo is open
      for (let i = 0; i < 5; i++) {
        const status = await unary(client, 'getStatus', { sessionId });
        console.log(`[smoke] getStatus #${i + 1} open=${status.isOpen} ${status.width}x${status.height}`);
      }
    })();

    await Promise.all([framePromise, statusPromise]);

    await unary(client, 'dispose', { sessionId });
    console.log('[smoke] ok');
  } finally {
    client.close();
    server.forceShutdown();
  }
}

main().catch((err) => {
  console.error('[smoke] failed', err);
  process.exit(1);
});
