import assert from 'assert';
import {
  cspDocumentMutator,
  handleDocumentResponsePausedForTest,
  installDocumentResponseHook,
} from './documentResponseHook';

/**
 * Unit: root Fetch.enable + OOPIF frame gets its own CDPSession Fetch.enable.
 */
export async function runDocumentResponseHookUnitTests(): Promise<void> {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const handlers = new Map<string, Function[]>();

  const makeSession = (label: string) => {
    const sessionCalls: Array<{ method: string; params?: unknown }> = [];
    const session = {
      label,
      send: async (method: string, params?: unknown) => {
        calls.push({ method, params, label } as { method: string; params?: unknown });
        sessionCalls.push({ method, params });
        return {};
      },
      on: (event: string, fn: Function) => {
        const list = handlers.get(`${label}:${event}`) ?? [];
        list.push(fn);
        handlers.set(`${label}:${event}`, list);
      },
      sessionCalls,
    };
    return session;
  };

  const root = makeSession('root');
  const frameSession = makeSession('frame');

  const childFrame = { url: () => 'https://challenges.cloudflare.com/turnstile' } as unknown as import('patchright').Frame;
  const mainFrame = { url: () => 'https://www.eneba.com/' } as unknown as import('patchright').Frame;

  const frameListeners: Array<(f: import('patchright').Frame) => void> = [];
  const page = {
    mainFrame: () => mainFrame,
    frames: () => [mainFrame, childFrame],
    on: (event: string, fn: (f: import('patchright').Frame) => void) => {
      if (event === 'frameattached' || event === 'framenavigated') {
        frameListeners.push(fn);
      }
    },
  } as unknown as import('patchright').Page;

  const context = {
    newCDPSession: async (target: import('patchright').Frame) => {
      assert.strictEqual(target, childFrame);
      return frameSession as unknown as import('patchright').CDPSession;
    },
  } as unknown as import('patchright').BrowserContext;

  await installDocumentResponseHook(root as unknown as import('patchright').CDPSession, {
    mutators: [(ctx) => ({ headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false })],
    page,
    context,
  });

  assert.ok(
    root.sessionCalls.some((c) => c.method === 'Fetch.enable'),
    'must Fetch.enable on page session',
  );
  assert.ok(
    frameSession.sessionCalls.some((c) => c.method === 'Fetch.enable'),
    'must Fetch.enable on OOPIF frame session',
  );
  assert.ok(
    handlers.has('root:Fetch.requestPaused'),
    'must listen Fetch.requestPaused on root',
  );
  assert.ok(
    handlers.has('frame:Fetch.requestPaused'),
    'must listen Fetch.requestPaused on frame',
  );

  console.log('[unit] documentResponseHook OOPIF frame CDPSession ok');

  await runDocumentResponseHookHeaderFallbackUnitTests();
}

/** getResponseBody failure must still continue with relaxed enforcing CSP headers. */
async function runDocumentResponseHookHeaderFallbackUnitTests(): Promise<void> {
  const strictCsp =
    "default-src 'self'; connect-src 'self' https://*.binance.com; script-src 'self'";
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === 'Fetch.getResponseBody') {
      throw new Error('simulated huge body CDP limit');
    }
    return {};
  };

  await handleDocumentResponsePausedForTest(
    send,
    {
      requestId: 'doc-huge-1',
      responseStatusCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'text/html; charset=utf-8' },
        { name: 'Content-Security-Policy', value: strictCsp },
      ],
      request: { url: 'https://www.binance.com/' },
    },
    [cspDocumentMutator],
  );

  const continued = calls.filter((c) => c.method === 'Fetch.continueResponse');
  assert.strictEqual(continued.length, 1, JSON.stringify(calls.map((c) => c.method)));
  const hdrs = (continued[0]!.params?.responseHeaders ?? []) as Array<{ name: string; value: string }>;
  const csp = hdrs.find((h) => h.name.toLowerCase() === 'content-security-policy')?.value ?? '';
  assert.ok(/\bconnect-src\b[^;]*\*/.test(csp), `connect-src widened in header fallback: ${csp}`);
  assert.ok(/\bws:/.test(csp), `ws: in header fallback: ${csp}`);
  assert.ok(!calls.some((c) => c.method === 'Fetch.continueResponse' && !c.params?.responseHeaders));

  console.log('[unit] documentResponseHook header fallback on getResponseBody fail ok');
}
