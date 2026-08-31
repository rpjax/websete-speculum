/**
 * K2 browser-level — session A credentialed bytes never reach session B (PP-ISO-2).
 * Also PP-ASSET-5: public cookie-less subresource deduped across sessions.
 */

import assert from 'node:assert';
import http from 'node:http';
import { createPageProjectionBrowserSessionFactory } from '../browser/mirror/projection/session/PageProjectionBrowserSession';
import { labLaunchOptions } from '../browser/mirror/projection/session/labLaunch';
import { SharedAssetCacheL2 } from './SharedAssetCacheL2';
import type { BrowserSessionEvents } from '../browser/BrowserSession';

function emptyEvents(): BrowserSessionEvents {
  return {
    onVideoFrame() {},
    onAudioFrame() {},
    onConsole() {},
    onLocationChanged() {},
    onMainFrameNavigationBlocked() {},
    onEditableFocusChanged() {},
    onCrash() {},
    onCameraPermissionRequested: async () => 'deny',
    onMicrophonePermissionRequested: async () => 'deny',
  };
}

function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no port'));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

export async function runSharedAssetK2UnitTests(): Promise<void> {
  const chromeExe = process.env['CHROME_EXECUTABLE']?.trim();
  if (!chromeExe) {
    console.log('[unit] shared asset K2 skipped (CHROME_EXECUTABLE unset)');
    return;
  }

  let credFetches = 0;
  const credSrv = await listen((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body>ok</body></html>');
      return;
    }
    if (path === '/private.css') {
      credFetches += 1;
      const cookie = req.headers.cookie ?? '';
      const body = cookie.includes('session=a') ? 'body-cred-a' : 'body-cred-none';
      res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'private' });
      res.end(body);
      return;
    }
    res.writeHead(404).end();
  });

  let publicFetches = 0;
  const pubSrv = await listen((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body>ok</body></html>');
      return;
    }
    if (path === '/public.css') {
      publicFetches += 1;
      res.writeHead(200, {
        'Content-Type': 'text/css',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end('body-public-v1');
      return;
    }
    res.writeHead(404).end();
  });

  const credKey = `127.0.0.1:${credSrv.port}/private.css`;
  const publicKey = `127.0.0.1:${pubSrv.port}/public.css`;

  const tier = new SharedAssetCacheL2();
  tier.configureOnce({ maxBytes: 1 << 20, enabled: true });
  const factory = createPageProjectionBrowserSessionFactory({
    headless: true,
    sharedAssetTier: tier,
  });

  const sessionA = factory.create('k2-a', emptyEvents());
  const sessionB = factory.create('k2-b', emptyEvents());
  let sessionC: ReturnType<typeof factory.create> | null = null;
  let sessionD: ReturnType<typeof factory.create> | null = null;
  const launch = labLaunchOptions({
    frameRateHz: 10,
    cpuProfiling: false,
    projectionDataPlane: 'loopback',
  });

  try {
    await sessionA.launch(launch);
    await sessionB.launch(launch);

    await sessionA.restoreState({
      cookies: [{
        name: 'session',
        value: 'a',
        domain: '127.0.0.1',
        path: '/',
        secure: false,
        httpOnly: false,
        sameSite: 'Lax',
      }],
      localStorage: [],
      idbRecords: [],
      history: [],
    });
    await sessionA.navigate(`http://127.0.0.1:${credSrv.port}/`);

    const aPrivate = await sessionA.getDomAsset!(credKey, { kind: 'asset' });
    assert.ok(aPrivate, 'session A private fetch');
    assert.strictEqual(Buffer.from(aPrivate!.body).toString('utf8'), 'body-cred-a');
    assert.strictEqual(credFetches, 1);

    await sessionB.navigate(`http://127.0.0.1:${credSrv.port}/`);
    const bPrivate = await sessionB.getDomAsset!(credKey, { kind: 'asset' });
    assert.ok(bPrivate, 'session B private fetch');
    const bBody = Buffer.from(bPrivate!.body).toString('utf8');
    assert.strictEqual(bBody, 'body-cred-none', `credentialed bleed: got ${bBody}`);
    assert.notStrictEqual(bBody, 'body-cred-a');
    assert.strictEqual(credFetches, 2);

    sessionC = factory.create('k2-c', emptyEvents());
    sessionD = factory.create('k2-d', emptyEvents());
    await sessionC.launch(launch);
    await sessionD.launch(launch);
    await sessionC.navigate(`http://127.0.0.1:${pubSrv.port}/`);
    await sessionD.navigate(`http://127.0.0.1:${pubSrv.port}/`);

    publicFetches = 0;
    const cPublic = await sessionC.getDomAsset!(publicKey, { kind: 'asset' });
    assert.ok(cPublic, 'session C public fetch');
    assert.strictEqual(Buffer.from(cPublic!.body).toString('utf8'), 'body-public-v1');
    assert.strictEqual(publicFetches, 1);
    assert.strictEqual(tier.count, 1, 'public asset must enter host L2 after first fetch');

    const dPublic = await sessionD.getDomAsset!(publicKey, { kind: 'asset' });
    assert.ok(dPublic, 'session D public fetch');
    assert.strictEqual(Buffer.from(dPublic!.body).toString('utf8'), 'body-public-v1');
    assert.strictEqual(publicFetches, 1, 'public asset must be L2-deduped across sessions');
  } finally {
    await sessionA.dispose();
    await sessionB.dispose();
    if (sessionC) await sessionC.dispose();
    if (sessionD) await sessionD.dispose();
    await new Promise<void>((resolve, reject) => {
      credSrv.server.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      pubSrv.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  console.log('[unit] shared asset K2 browser-level ok');
}
