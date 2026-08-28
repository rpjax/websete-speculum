import assert from 'assert';
import type { Frame, Page } from 'patchright';
import { ProjectionRuntimeInstaller } from './projectionRuntimeInstaller';
import { INJECT_ARM_GLOBAL } from './injectSentinel';

type CdpCall = { method: string; params?: Record<string, unknown> };

function countBundleEvals(calls: CdpCall[]): number {
  return calls.filter(
    (c) =>
      c.method === 'Runtime.evaluate' &&
      String(c.params?.expression ?? '').includes('__SPECULUM_PP_INJECT_V1__'),
  ).length;
}

export async function runProjectionRuntimeInstallerUnitTests(): Promise<void> {
  const calls: CdpCall[] = [];

  const rootCdp = {
    send: async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        const expr = String(params?.expression ?? '');
        if (expr.includes('__speculumProjection') || expr.includes(INJECT_ARM_GLOBAL)) {
          if (!expr.includes('__SPECULUM_PP_INJECT_V1__') && expr.length < 500) {
            return { result: { value: true } };
          }
        }
        return { result: { value: undefined } };
      }
      return {};
    },
  };

  let childUrl = 'https://challenges.cloudflare.com/turnstile';
  const childFrame = {
    url: () => childUrl,
  } as unknown as Frame;
  const mainFrame = {
    url: () => 'about:blank',
    evaluate: async () => false,
  } as unknown as Frame;

  const page = {
    mainFrame: () => mainFrame,
    frames: () => [mainFrame, childFrame],
    on: () => {},
  } as unknown as Page;

  const frameCdpCalls: CdpCall[] = [];
  let childPresent: boolean | null = false;
  const frameCdp: { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> } = {
    send: async (method: string, params?: Record<string, unknown>) => {
      frameCdpCalls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        const expr = String(params?.expression ?? '');
        if (expr.includes('__SPECULUM_PP_INJECT_V1__')) {
          childPresent = true;
          return { result: { value: undefined } };
        }
        if (expr.includes('__speculumProjection') || expr.includes(INJECT_ARM_GLOBAL)) {
          if (childPresent === null) {
            return { exceptionDetails: { text: 'probe unavailable' } };
          }
          return { result: { value: childPresent } };
        }
        return { result: { value: undefined } };
      }
      return {};
    },
  };

  const context = {
    newCDPSession: async (frame: Frame) => {
      assert.strictEqual(frame, childFrame);
      return frameCdp;
    },
  };

  const installer = new ProjectionRuntimeInstaller({
    context: context as never,
    page,
    rootCdp: rootCdp as never,
    config: {
      sessionId: 'sess-1',
      transport: 'loopback',
      dataPlaneUrl: 'ws://127.0.0.1:40133/',
      planeBridgeToken: '550e8400-e29b-41d4-a716-446655440000',
      generation: 2,
    },
    launchScripts: [],
    includeCspDiag: false,
  });

  await installer.install();

  assert.ok(
    calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'),
    'root must register addScriptToEvaluateOnNewDocument',
  );
  assert.ok(
    frameCdpCalls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'),
    'OOPIF frame must register addScriptToEvaluateOnNewDocument',
  );

  const rootSource = calls.find((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument')?.params
    ?.source as string;
  assert.ok(rootSource?.includes('__SPECULUM_PP_INJECT_V1__'));
  assert.ok(rootSource?.includes(INJECT_ARM_GLOBAL), 'bundle must include inject arm');
  assert.ok(!rootSource?.includes('<script'));

  assert.strictEqual(countBundleEvals(frameCdpCalls), 1, 'empty probe → one lateBoot inject');
  assert.ok(
    frameCdpCalls
      .filter(
        (c) =>
          c.method === 'Runtime.evaluate' &&
          String(c.params?.expression ?? '').includes('__SPECULUM_PP_INJECT_V1__'),
      )
      .every((c) => c.params?.awaitPromise === false),
    'lateBoot inject must not awaitPromise',
  );

  // Second attach same URL: present true OR already_attempted → no second inject.
  const beforeSecond = frameCdpCalls.length;
  await installer.attachFrameForTest(childFrame);
  assert.strictEqual(
    countBundleEvals(frameCdpCalls.slice(beforeSecond)),
    0,
    'same doc → no second lateBoot inject',
  );

  // Force present=false but same URL → token already_attempted blocks inject.
  childPresent = false;
  const beforeToken = frameCdpCalls.length;
  await installer.attachFrameForTest(childFrame);
  assert.strictEqual(
    countBundleEvals(frameCdpCalls.slice(beforeToken)),
    0,
    'same generation|url token → already_attempted skips inject',
  );

  // New URL on same frame → one new inject allowed.
  childUrl = 'https://challenges.cloudflare.com/turnstile?v=2';
  childPresent = false;
  const beforeNewUrl = frameCdpCalls.length;
  await installer.attachFrameForTest(childFrame);
  assert.strictEqual(
    countBundleEvals(frameCdpCalls.slice(beforeNewUrl)),
    1,
    'new URL → one lateBoot inject',
  );

  // probe_null fail-closed → zero bundle eval.
  childUrl = 'https://challenges.cloudflare.com/turnstile?v=probe-null';
  childPresent = null;
  const beforeNull = frameCdpCalls.length;
  await installer.attachFrameForTest(childFrame);
  assert.strictEqual(
    countBundleEvals(frameCdpCalls.slice(beforeNull)),
    0,
    'probe null → fail-closed, no lateBoot inject',
  );

  // Navigated main with live boot → skip inject.
  const navMain = {
    url: () => 'https://www.eneba.com/',
    evaluate: async () => {
      throw new Error('must not use Patchright isolate evaluate for lateBoot product path');
    },
  } as unknown as Frame;
  const navPage = {
    mainFrame: () => navMain,
    frames: () => [navMain],
    on: () => {},
  } as unknown as Page;
  const navCalls: CdpCall[] = [];
  const navRoot = {
    send: async (method: string, params?: Record<string, unknown>) => {
      navCalls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        return { result: { value: true } };
      }
      return {};
    },
  };
  const navInstaller = new ProjectionRuntimeInstaller({
    context: { newCDPSession: async () => navRoot } as never,
    page: navPage,
    rootCdp: navRoot as never,
    config: {
      sessionId: 'sess-2',
      transport: 'loopback',
      dataPlaneUrl: 'ws://127.0.0.1:40133/',
      planeBridgeToken: '550e8400-e29b-41d4-a716-446655440000',
      generation: 2,
    },
    launchScripts: [],
  });
  await navInstaller.install();
  assert.strictEqual(
    countBundleEvals(navCalls),
    0,
    'main-world boot already present → lateBoot must not re-inject bundle',
  );

  console.log('[unit] projectionRuntimeInstaller ok');
}
