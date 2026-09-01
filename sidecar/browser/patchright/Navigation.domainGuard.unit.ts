import assert from 'assert';
import {
  isMainFrameNavigationBlocked,
  tryBlockPausedMainFrameDocument,
  installMainFrameDomainGuard,
} from './Navigation';
import type { CDPSession } from 'patchright';

export async function runMainFrameDomainGuardUnitTests(): Promise<void> {
  assert.strictEqual(
    isMainFrameNavigationBlocked('https://evil.com/x', ['example.com']),
    true,
  );
  assert.strictEqual(
    isMainFrameNavigationBlocked('https://example.com/x', ['example.com']),
    false,
  );
  assert.strictEqual(
    isMainFrameNavigationBlocked('https://www.example.com/x', ['*.example.com']),
    false,
  );
  assert.strictEqual(isMainFrameNavigationBlocked('about:blank', ['example.com']), false);
  assert.strictEqual(isMainFrameNavigationBlocked('https://evil.com/', []), false);

  const sends: Array<{ method: string; params?: unknown }> = [];
  let blockedUrl: string | null = null;
  const send = async (method: string, params?: Record<string, unknown>) => {
    sends.push({ method, params });
    return {};
  };

  const blocked = await tryBlockPausedMainFrameDocument(
    send,
    {
      requestId: 'r1',
      request: { url: 'https://evil.com/path' },
      frameId: 'main',
    },
    {
      allowedNavigationDomains: ['example.com'],
      onBlocked: (u) => {
        blockedUrl = u;
      },
      mainFrameId: 'main',
    },
  );
  assert.strictEqual(blocked, true);
  assert.strictEqual(blockedUrl, 'https://evil.com/path');
  assert.ok(sends.some((s) => s.method === 'Fetch.failRequest'));

  sends.length = 0;
  blockedUrl = null;
  const allowed = await tryBlockPausedMainFrameDocument(
    send,
    {
      requestId: 'r2',
      request: { url: 'https://example.com/' },
      frameId: 'main',
    },
    {
      allowedNavigationDomains: ['example.com'],
      onBlocked: (u) => {
        blockedUrl = u;
      },
      mainFrameId: 'main',
    },
  );
  assert.strictEqual(allowed, false);
  assert.strictEqual(blockedUrl, null);
  assert.ok(!sends.some((s) => s.method === 'Fetch.failRequest'));

  // Response-stage events are not domain-blocked here.
  const responseStage = await tryBlockPausedMainFrameDocument(
    send,
    {
      requestId: 'r3',
      responseStatusCode: 200,
      request: { url: 'https://evil.com/' },
      frameId: 'main',
    },
    {
      allowedNavigationDomains: ['example.com'],
      onBlocked: () => {
        throw new Error('should not block response stage');
      },
      mainFrameId: 'main',
    },
  );
  assert.strictEqual(responseStage, false);

  const handlers = new Map<string, Function[]>();
  const cdp = {
    send: async (method: string, params?: unknown) => {
      sends.push({ method, params });
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'mf' } } };
      }
      return {};
    },
    on: (event: string, fn: Function) => {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
  };
  sends.length = 0;
  await installMainFrameDomainGuard(cdp as unknown as CDPSession, {
    allowedNavigationDomains: ['example.com'],
    onBlocked: () => undefined,
    sessionId: 'unit',
  });
  assert.ok(sends.some((s) => s.method === 'Fetch.enable'));
  assert.ok(handlers.has('Fetch.requestPaused'));

  console.log('[unit] main-frame domain guard ok');
}
