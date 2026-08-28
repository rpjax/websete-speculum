import assert from 'assert';
import type { Frame, Page } from 'patchright';
import { ProjectionRuntimeInstaller } from './projectionRuntimeInstaller';

export async function runProjectionRuntimeInstallerUnitTests(): Promise<void> {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  const rootCdp = {
    send: async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      return {};
    },
  };

  const childFrame = { url: () => 'https://challenges.cloudflare.com/turnstile' } as unknown as Frame;
  const mainFrame = {
    url: () => 'about:blank',
    evaluate: async () => false,
  } as unknown as Frame;

  const page = {
    mainFrame: () => mainFrame,
    frames: () => [mainFrame, childFrame],
    on: () => {},
  } as unknown as Page;

  const frameCdpCalls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const frameCdp = {
    send: async (method: string, params?: Record<string, unknown>) => {
      frameCdpCalls.push({ method, params });
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
  await installer.attachFrameForTest(childFrame);

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
  assert.ok(!rootSource?.includes('<script'));

  console.log('[unit] projectionRuntimeInstaller ok');
}
