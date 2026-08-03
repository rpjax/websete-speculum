import assert from 'assert';
import * as fs from 'fs';
import {
  domainMatches,
  injectPermissiveMainFrameCsp,
  matchesAllowedDomain,
  pathMatches,
  relaxMainFrameCspHeaders,
  scriptMatchesUrl,
} from './browser/patchright/Navigation';
import type { BrowserScriptInjection } from './browser/BrowserSession';
import { isInputTouchPrimary, resolveDeviceProfile, deviceProfilesEqual, touchEmulationParams, DEFAULT_DESKTOP_DEVICE, applyLogicalViewport, proveLogicalViewport, readChromeViewport, viewportMetricsClose } from './browser/patchright/device-emulation';
import { buildChromeArgs, webglSpoofExtensionPath } from './browser/patchright/ChromeRuntime';
import { validateLaunchViewport, validateResizeViewport, requireViewportPolicy } from './browser/patchright/viewport-bounds';
import { shouldEmitContextCrash } from './browser/patchright/contextCrash';
import { toLaunchOptions } from './grpc/mappers';
import { EventBridge } from './host/EventBridge';
import { DropOldestQueue } from './host/DropOldestQueue';
import { isBenignBrowserRace } from './host/browserRace';
import type { CDPSession } from 'patchright';
import {
  sanitizeCookieForCdp,
  sanitizeCookieBatch,
} from './browser/patchright/PageState';
import type { BrowserCookieState } from './browser/BrowserSession';
import { collectTelemetry } from './telemetry/collectTelemetry';
import { applyHostResources } from './host/hostResources';

/** Test stand-in for Sessions.ViewportPolicy — production gets this on Launch. */
const POLICY = {
  minWidth: 100,
  minHeight: 100,
  maxWidth: 4096,
  maxHeight: 2160,
} as const;

function testDomainMatch(): void {
  assert.strictEqual(matchesAllowedDomain('example.com', ['example.com']), true);
  assert.strictEqual(matchesAllowedDomain('www.example.com', ['*.example.com']), true);
  assert.strictEqual(matchesAllowedDomain('evil.com', ['example.com']), false);
  assert.strictEqual(matchesAllowedDomain('example.com', ['*.example.com']), false);
  console.log('[unit] domain match ok');
}

function testScriptTargetRuleMatch(): void {
  const anyAny: BrowserScriptInjection = {
    position: 'HeaderTop',
    type: 'Classic',
    file: '/s.js',
    content: '1',
    targetRules: [{
      domain: { scope: 'Any', labels: [] },
      path: { scope: 'Any', matchType: 'Prefix', segments: [] },
    }],
  };
  assert.strictEqual(scriptMatchesUrl(anyAny, new URL('https://a.example.com/x')), true);

  const emptyRules: BrowserScriptInjection = {
    position: 'HeaderTop',
    type: 'Classic',
    file: '/s.js',
    content: '1',
    targetRules: [],
  };
  assert.strictEqual(scriptMatchesUrl(emptyRules, new URL('https://a.example.com/x')), false);

  const wildcard = {
    scope: 'Pattern',
    labels: [
      { match: 'Any', value: '' },
      { match: 'Exact', value: 'example' },
      { match: 'Exact', value: 'com' },
    ],
  };
  assert.strictEqual(domainMatches(wildcard, 'www.example.com'), true);
  assert.strictEqual(domainMatches(wildcard, 'a.b.example.com'), true);
  assert.strictEqual(domainMatches(wildcard, 'example.com'), false);
  assert.strictEqual(domainMatches(wildcard, 'evil.com'), false);

  const exact = {
    scope: 'Pattern',
    labels: [
      { match: 'Exact', value: 'www' },
      { match: 'Exact', value: 'example' },
      { match: 'Exact', value: 'com' },
    ],
  };
  assert.strictEqual(domainMatches(exact, 'www.example.com'), true);
  assert.strictEqual(domainMatches(exact, 'a.www.example.com'), false);

  const midWildcard = {
    scope: 'Pattern',
    labels: [
      { match: 'Exact', value: 'api' },
      { match: 'Any', value: '' },
      { match: 'Exact', value: 'com' },
    ],
  };
  assert.strictEqual(domainMatches(midWildcard, 'api.x.com'), false);

  assert.strictEqual(
    pathMatches({ scope: 'Pattern', matchType: 'Prefix', segments: [{ match: 'Exact', value: 'app' }] }, '/app/x'),
    true,
  );
  assert.strictEqual(
    pathMatches({ scope: 'Pattern', matchType: 'Exact', segments: [{ match: 'Exact', value: 'app' }] }, '/app/x'),
    false,
  );
  assert.strictEqual(
    pathMatches({ scope: 'Pattern', matchType: 'Exact', segments: [{ match: 'Exact', value: 'app' }] }, '/app'),
    true,
  );

  // camelCase wire tolerance
  assert.strictEqual(
    domainMatches({ scope: 'any', labels: [] } as never, 'x.com'),
    true,
  );
  console.log('[unit] script target rule match ok');
}

function testPermissiveMainFrameCspRewrite(): void {
  const headers = relaxMainFrameCspHeaders([
    { name: 'Content-Type', value: 'text/html; charset=utf-8' },
    { name: 'Content-Security-Policy', value: "default-src 'self'" },
    { name: 'Content-Security-Policy-Report-Only', value: "script-src 'none'" },
  ]);
  assert.strictEqual(headers.some((h) => h.name.toLowerCase() === 'content-security-policy-report-only'), false);
  assert.strictEqual(headers.filter((h) => h.name.toLowerCase() === 'content-security-policy').length, 1);
  assert.ok(headers.some((h) => h.name === 'Content-Security-Policy' && h.value.includes('connect-src *')));

  const html = '<html><head><title>x</title></head><body>ok</body></html>';
  const patched = injectPermissiveMainFrameCsp(html);
  assert.ok(patched.includes('http-equiv="Content-Security-Policy"'));
  assert.ok(patched.includes("script-src * data: blob: 'unsafe-inline' 'unsafe-eval'"));
  assert.ok(patched.includes('connect-src * data: blob: ws: wss:'));
  console.log('[unit] permissive main-frame csp rewrite ok');
}

function testViewportBounds(): void {
  const invalidLaunch = validateLaunchViewport(0, 0, POLICY);
  assert.strictEqual(invalidLaunch.ok, false);

  const validLaunch = validateLaunchViewport(800, 600, POLICY);
  assert.strictEqual(validLaunch.ok, true);
  if (validLaunch.ok) {
    assert.strictEqual(validLaunch.width, 800);
    assert.strictEqual(validLaunch.height, 600);
  }

  const ok = validateResizeViewport(800, 600, POLICY);
  assert.strictEqual(ok.ok, true);

  const tooSmall = validateResizeViewport(10, 10, POLICY);
  assert.strictEqual(tooSmall.ok, false);

  const tooBig = validateResizeViewport(9000, 9000, POLICY);
  assert.strictEqual(tooBig.ok, false);

  const tight = { minWidth: 300, minHeight: 200, maxWidth: 1600, maxHeight: 1200 };
  assert.strictEqual(validateResizeViewport(299, 600, tight).ok, false);
  assert.strictEqual(validateResizeViewport(800, 600, tight).ok, true);

  assert.throws(
    () => requireViewportPolicy({}),
    /ViewportPolicy bounds/,
  );
  assert.deepStrictEqual(
    requireViewportPolicy({
      minWidth: 100,
      minHeight: 100,
      displayWidth: 2048,
      displayHeight: 1080,
    }),
    { minWidth: 100, minHeight: 100, maxWidth: 2048, maxHeight: 1080 },
  );
  console.log('[unit] viewport bounds ok');
}

function testResolveDeviceProfileDefaults(): void {
  assert.deepStrictEqual(resolveDeviceProfile(null), DEFAULT_DESKTOP_DEVICE);
  assert.deepStrictEqual(resolveDeviceProfile(undefined), DEFAULT_DESKTOP_DEVICE);
  const partial = resolveDeviceProfile({ mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 });
  assert.strictEqual(partial.mobile, true);
  assert.strictEqual(partial.deviceScaleFactor, 2);
  assert.strictEqual(partial.maxTouchPoints, 5);
  const missingDpr = resolveDeviceProfile({ mobile: false, touch: false });
  assert.strictEqual(missingDpr.deviceScaleFactor, 1);
  assert.strictEqual(missingDpr.maxTouchPoints, 0);
  assert.strictEqual(deviceProfilesEqual(null, undefined), true);
  assert.strictEqual(
    deviceProfilesEqual(
      { mobile: false, touch: false, deviceScaleFactor: 1, maxTouchPoints: 0 },
      DEFAULT_DESKTOP_DEVICE,
    ),
    true,
  );
  assert.strictEqual(
    deviceProfilesEqual(
      { mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 },
      DEFAULT_DESKTOP_DEVICE,
    ),
    false,
  );
  console.log('[unit] resolve device profile defaults ok');
}

async function testApplyLogicalViewportUsesDeviceMetricsOnly(): Promise<void> {
  const calls: Array<{ method: string; params: unknown }> = [];
  const cdp = {
    send: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'Browser.getWindowForTarget') return { windowId: 7 };
      if (method === 'Browser.getVersion') {
        return { product: 'Chrome/120.0.0.0', userAgent: 'Mozilla/5.0 Desktop' };
      }
      return {};
    },
  } as unknown as CDPSession;

  const profile = await applyLogicalViewport(cdp, 1024, 768, null);
  assert.strictEqual(profile.deviceScaleFactor, 1);
  assert.strictEqual(profile.mobile, false);

  assert.ok(
    !calls.some((c) => c.method === 'Browser.setWindowBounds'),
    'soft logical viewport must not mutate native window bounds',
  );

  const metrics = calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.ok(metrics, 'must apply device metrics');
  assert.strictEqual((metrics!.params as { width: number }).width, 1024);
  assert.strictEqual((metrics!.params as { height: number }).height, 768);
  assert.strictEqual((metrics!.params as { deviceScaleFactor: number }).deviceScaleFactor, 1);
  assert.strictEqual((metrics!.params as { screenWidth: number }).screenWidth, 1024);
  assert.strictEqual((metrics!.params as { screenHeight: number }).screenHeight, 768);

  // Desktop apply must clear UA (even after prior mobile) — no early-return skip.
  const ua = calls.find((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(ua, 'desktop apply must set/clear user agent');
  assert.strictEqual((ua!.params as { userAgent: string }).userAgent, 'Mozilla/5.0 Desktop');
  const meta = (ua!.params as { userAgentMetadata?: { mobile?: boolean; platform?: string; brands?: unknown[] } })
    .userAgentMetadata;
  assert.ok(meta, 'desktop apply must send userAgentMetadata');
  assert.strictEqual(meta!.mobile, false);
  assert.strictEqual(meta!.platform, 'Linux');
  assert.ok(Array.isArray(meta!.brands) && meta!.brands.length >= 3, 'greasy brands required');

  const metricsIdx = calls.findIndex((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  const uaIdx = calls.findIndex((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(uaIdx >= 0 && metricsIdx > uaIdx, 'device metrics must apply after user-agent override');

  await assert.rejects(
    () =>
      applyLogicalViewport(
        {
          send: async (method: string) => {
            if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
            if (method === 'Browser.getVersion') return { product: 'Chrome/120.0.0.0' };
            return {};
          },
        } as unknown as CDPSession,
        800,
        600,
        null,
      ),
    /did not return userAgent/,
  );
  console.log('[unit] apply logical viewport uses device metrics only ok');
}

async function testProveLogicalViewportUsesCssLayoutMetrics(): Promise<void> {
  const calls: Array<{ method: string; params: unknown }> = [];
  const cdp = {
    send: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'Browser.getVersion') {
        return {
          product: 'Chrome/120.0.0.0',
          userAgent:
            'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        };
      }
      if (method === 'Page.getLayoutMetrics') {
        // Simulate the mobile about:blank trap: JS innerWidth would be 980, but CDP
        // cssLayoutViewport reflects Emulation.setDeviceMetricsOverride.
        return {
          cssLayoutViewport: { clientWidth: 414, clientHeight: 713 },
          layoutViewport: { clientWidth: 980, clientHeight: 1688 },
        };
      }
      return {};
    },
  } as unknown as CDPSession;

  const proven = await proveLogicalViewport(
    cdp,
    414,
    713,
    { mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 },
    { phase: 'launch' },
  );
  assert.strictEqual(proven.width, 414);
  assert.strictEqual(proven.height, 713);
  assert.strictEqual(proven.device.deviceScaleFactor, 2);
  assert.ok(calls.some((c) => c.method === 'Emulation.setDeviceMetricsOverride'));
  assert.ok(calls.some((c) => c.method === 'Page.getLayoutMetrics'));
  const metricsIdx = calls.findIndex((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  const uaIdx = calls.findIndex((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(uaIdx >= 0 && metricsIdx > uaIdx, 'mobile metrics must apply after UA (avoid 980px trap)');

  await assert.rejects(
    () =>
      proveLogicalViewport(
        {
          send: async (method: string) => {
            if (method === 'Browser.getVersion') {
              return { product: 'Chrome/120.0.0.0', userAgent: 'Mozilla/5.0 Desktop' };
            }
            if (method === 'Page.getLayoutMetrics') {
              return { cssLayoutViewport: { clientWidth: 980, clientHeight: 1688 } };
            }
            return {};
          },
        } as unknown as CDPSession,
        414,
        713,
        null,
      ),
    /css layout viewport 980×1688 != logical 414×713/,
  );

  await assert.rejects(
    () =>
      readChromeViewport({
        send: async () => ({}),
      } as unknown as CDPSession),
    /did not return cssLayoutViewport/,
  );

  assert.ok(viewportMetricsClose(414, 713, 415, 712));
  assert.ok(!viewportMetricsClose(414, 713, 980, 1688));
  console.log('[unit] prove logical viewport uses css layout metrics ok');
}

function testBuildChromeArgsIncludesWebglSpoof(): void {
  const prev = process.env['SPECULUM_GL_FALLBACK'];
  try {
    delete process.env['SPECULUM_GL_FALLBACK'];
    const extensionPath = webglSpoofExtensionPath();
    assert.ok(fs.existsSync(extensionPath), `extension must exist at ${extensionPath}`);
    const args = buildChromeArgs(1280, 720);
    assert.ok(args.includes('--use-gl=swiftshader'), 'swiftshader required');
    assert.ok(
      args.some((a) => a.startsWith('--load-extension=') && a.includes('webgl-spoof')),
      'load-extension webgl-spoof required',
    );
    assert.ok(
      args.some((a) => a.includes('DisableLoadExtensionCommandLineSwitch')),
      'Chrome ≥137 load-extension feature flag required',
    );

    process.env['SPECULUM_GL_FALLBACK'] = '0';
    const off = buildChromeArgs(800, 600);
    assert.ok(!off.includes('--use-gl=swiftshader'), 'SPECULUM_GL_FALLBACK=0 disables GL spoof');
  } finally {
    if (prev === undefined) delete process.env['SPECULUM_GL_FALLBACK'];
    else process.env['SPECULUM_GL_FALLBACK'] = prev;
  }
  console.log('[unit] buildChromeArgs webgl spoof ok');
}

async function testScreencastRestartThrowsAfterStop(): Promise<void> {
  const { Screencast } = await import('./browser/patchright/Screencast');
  const cdp = {
    on: () => {},
    off: () => {},
    send: async () => ({}),
  } as unknown as CDPSession;
  const sc = await Screencast.start(cdp, 100, 100, () => {});
  await sc.stop();
  await assert.rejects(
    () => sc.restart(200, 200, () => {}),
    /restart after stop/,
  );
  console.log('[unit] screencast restart throws after stop ok');
}

function testLaunchEnvironmentIsRequired(): void {
  assert.throws(
    () => toLaunchOptions({ width: 800, height: 600 }),
    /ViewportPolicy bounds|locale is required/,
  );

  assert.throws(
    () =>
      toLaunchOptions({
        width: 800,
        height: 600,
        minWidth: 100,
        minHeight: 100,
        displayWidth: 4096,
        displayHeight: 2160,
      }),
    /locale is required/,
  );

  const options = toLaunchOptions({
    width: 800,
    height: 600,
    minWidth: 100,
    minHeight: 100,
    displayWidth: 2048,
    displayHeight: 1080,
    locale: 'pt-BR',
    language: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    geolocation: {
      latitude: -23.55,
      longitude: -46.63,
      accuracy: 10,
    },
  });
  assert.strictEqual(options.locale, 'pt-BR');
  assert.strictEqual(options.geolocation?.accuracy, 10);
  assert.deepStrictEqual(options.viewportPolicy, {
    minWidth: 100,
    minHeight: 100,
    maxWidth: 2048,
    maxHeight: 1080,
  });
  console.log('[unit] launch environment ok');
}

function testTouchEmulationParams(): void {
  assert.deepStrictEqual(
    touchEmulationParams({ touch: false, mobile: false, maxTouchPoints: 0 }),
    { enabled: false },
  );
  assert.deepStrictEqual(
    touchEmulationParams({ touch: true, mobile: false, maxTouchPoints: 5 }),
    { enabled: true, maxTouchPoints: 5 },
  );
  assert.throws(
    () => touchEmulationParams({ touch: true, mobile: false, maxTouchPoints: 0 }),
    /between 1 and 16/,
  );
  // Hybrid desktop: touch capability must NOT suppress mouse input.
  assert.strictEqual(isInputTouchPrimary({ mobile: false }), false);
  assert.strictEqual(isInputTouchPrimary({ mobile: true }), true);
  assert.strictEqual(isInputTouchPrimary(null), false);
  console.log('[unit] touch emulation params ok');
}

function applyContextClose(
  bridge: EventBridge,
  args: { listenerEpoch: number; currentEpoch: number; suppress: boolean },
  session: { open: boolean },
): void {
  if (!shouldEmitContextCrash(args)) return;
  session.open = false;
  bridge.onCrash({
    errorCode: 'browser_closed',
    message: 'Chrome context closed unexpectedly',
    phase: 'runtime',
  });
}

function testStopDoesNotEnqueueCrash(): void {
  const bridge = new EventBridge('s1');
  const session = { open: true };
  // stop/teardown: bump epoch + suppress before close
  applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 2, suppress: true }, session);
  assert.strictEqual(bridge.crash.pendingCount, 0);
  assert.strictEqual(session.open, true, 'suppressed/stale close must not clear open');
  console.log('[unit] stop_does_not_enqueue_crash ok');
}

function testUnexpectedContextCloseEnqueuesCrash(): void {
  const bridge = new EventBridge('s2');
  const session = { open: true };
  applyContextClose(bridge, { listenerEpoch: 3, currentEpoch: 3, suppress: false }, session);
  assert.strictEqual(bridge.crash.pendingCount, 1);
  assert.strictEqual(session.open, false);
  console.log('[unit] unexpected_context_close_enqueues_crash ok');
}

function testRecreateKeepsOpenAcrossStaleClose(): void {
  const bridge = new EventBridge('s4');
  const session = { open: true };
  // Intentional teardown: invalidate epoch + suppress before old context close
  applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 2, suppress: true }, session);
  assert.strictEqual(bridge.crash.pendingCount, 0);
  assert.strictEqual(session.open, true);
  // bind new context (epoch 3), session marked open again
  session.open = true;
  // deferred stale close from old context after new bind
  applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 3, suppress: false }, session);
  assert.strictEqual(bridge.crash.pendingCount, 0);
  assert.strictEqual(session.open, true);
  // real crash on current context
  applyContextClose(bridge, { listenerEpoch: 3, currentEpoch: 3, suppress: false }, session);
  assert.strictEqual(bridge.crash.pendingCount, 1);
  assert.strictEqual(session.open, false);
  console.log('[unit] stale_context_close_epoch ok');
}

async function testStopKeepsBridgeQueuesOpen(): Promise<void> {
  const bridge = new EventBridge('s3');
  bridge.onVideoFrame(new Uint8Array([1, 2, 3]));
  // stop() must not call bridge.close — queues stay open for Watch*
  assert.strictEqual(bridge.video.isClosed, false);
  const frame = await bridge.video.read();
  assert.ok(frame);
  assert.strictEqual(frame!.length, 3);

  const pending = bridge.video.read();
  const raced = await Promise.race([
    pending.then(() => 'read' as const),
    new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 40)),
  ]);
  assert.strictEqual(raced, 'timeout', 'read must block while bridge is open and empty');

  bridge.close();
  const afterClose = await pending;
  assert.strictEqual(afterClose, null, 'only bridge.close() ends Watch* reads with null');
  assert.strictEqual(bridge.video.isClosed, true);
  console.log('[unit] stop_keeps_bridge_queues_open ok');
}

function testBenignBrowserRaceNarrow(): void {
  assert.strictEqual(isBenignBrowserRace(new Error('Frame was detached')), true);
  assert.strictEqual(isBenignBrowserRace(new Error('Target closed')), true);
  assert.strictEqual(isBenignBrowserRace(new Error('Protocol error (Runtime.callFunctionOn)')), false);
  assert.strictEqual(isBenignBrowserRace(new Error('Session closed')), false);
  assert.strictEqual(isBenignBrowserRace(new Error('Target page, context or browser has been closed')), true);
  console.log('[unit] benign browser race narrow ok');
}

async function testAbortDoesNotStealQueuedCrash(): Promise<void> {
  const q = new DropOldestQueue<{ errorCode: string }>(4);
  q.tryWrite({ errorCode: 'browser_closed' });
  const ac = new AbortController();
  ac.abort();
  const stolen = await q.read(ac.signal);
  assert.strictEqual(stolen, null, 'aborted read must not dequeue');
  assert.strictEqual(q.pendingCount, 1, 'crash must remain for WatchCrash reopen');
  const next = await q.read();
  assert.deepStrictEqual(next, { errorCode: 'browser_closed' });
  console.log('[unit] abort_does_not_steal_queued_crash ok');
}

function testDropOldestQueueTracksDroppedCount(): void {
  const q = new DropOldestQueue<number>(2);
  q.tryWrite(1);
  q.tryWrite(2);
  q.tryWrite(3);
  q.tryWrite(4);
  assert.strictEqual(q.pendingCount, 2);
  assert.strictEqual(q.droppedCount, 2);
  console.log('[unit] drop_oldest_queue_tracks_dropped_count ok');
}

async function testPermissionClearRespectsEpoch(): Promise<void> {
  const bridge = new EventBridge('s-perm');
  const sinkA = (): void => {};
  const sinkB = (): void => {};
  const epochA = bridge.setPermissionSink(sinkA);
  const epochB = bridge.setPermissionSink(sinkB);
  // Waiter created under sink B must survive old Control A's cleanup.
  const pending = bridge.onCameraPermissionRequested();
  bridge.clearPermissionSink(sinkA, epochA);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(settled, false, 'waiter from epoch B must not be denied by epoch A clear');
  bridge.resolvePermission(1, true);
  assert.strictEqual(await pending, 'allow');
  bridge.clearPermissionSink(sinkB, epochB);
  console.log('[unit] permission_clear_respects_epoch ok');
}

async function testInputFireAndForgetAndMoveCoalesce(): Promise<void> {
  const ops: string[] = [];
  let resolveSlow: (() => void) | null = null;
  const slow = new Promise<void>((r) => { resolveSlow = r; });

  let moveCount = 0;
  let lastMoveX = 0;
  let lastMoveY = 0;

  const page = {
    mouse: {
      move: async () => { throw new Error('page.mouse must not be used'); },
      down: async () => { throw new Error('page.mouse must not be used'); },
      up:   async () => { throw new Error('page.mouse must not be used'); },
      wheel: async () => { throw new Error('page.mouse must not be used'); },
    },
    keyboard: {
      down: async (_k: string) => { ops.push('kdown'); },
      up:   async (_k: string) => { ops.push('kup'); },
      type: async () => { throw new Error('keyboard.type must not be used'); },
    },
    goBack:    () => Promise.reject(new Error('should not block')),
    goForward: () => Promise.reject(new Error('should not block')),
    evaluate:  async () => null,
  };
  const cdp = {
    send: async (method: string, params?: { type?: string; x?: number; y?: number }) => {
      if (method !== 'Input.dispatchMouseEvent') return;
      if (params?.type === 'mouseMoved') {
        ops.push('move');
        moveCount++;
        lastMoveX = params.x ?? 0;
        lastMoveY = params.y ?? 0;
        return;
      }
      if (params?.type === 'mousePressed') {
        ops.push('down');
        await slow;
        return;
      }
      if (params?.type === 'mouseReleased') {
        ops.push('up');
      }
    },
  };

  const { InputController } = await import('./browser/patchright/Input');
  const { PatchrightInputBackend } = await import('./browser/patchright/input/PatchrightInputBackend');
  const input = new InputController(page as never, new PatchrightInputBackend(page as never, cdp as never));

  input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
  input.enqueue({ type: 'mouseup',   x: 1, y: 2, button: 0 });
  input.enqueue({ type: 'keydown',   key: 'a' });

  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.ok(ops.includes('down'), 'mousedown must have started');
  assert.ok(!ops.includes('up'),  'mouseup must be held behind slow mousedown');

  input.enqueue({ type: 'mousemove', x: 10, y: 10 });
  input.enqueue({ type: 'mousemove', x: 20, y: 20 });
  input.enqueue({ type: 'mousemove', x: 30, y: 30 });
  const movesBeforeFlush = moveCount;
  await new Promise<void>((r) => setImmediate(r));
  assert.strictEqual(moveCount, movesBeforeFlush, 'coalesced move must not flush while chain is held');

  input.enqueue({ type: 'goback' });
  input.enqueue({ type: 'goforward' });

  resolveSlow!();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setImmediate(r));
  for (let i = 0; i < 30; i++) await Promise.resolve();

  assert.ok(ops.indexOf('down') < ops.indexOf('up'),   'down before up');
  assert.ok(ops.indexOf('up')   < ops.indexOf('kdown'), 'up before keydown');
  assert.ok(moveCount > movesBeforeFlush, 'coalesced move must flush after chain drains');
  assert.strictEqual(lastMoveX, 30, 'coalesced to last move x=30');
  assert.strictEqual(lastMoveY, 30, 'coalesced to last move y=30');
  assert.strictEqual(input.pendingCount, 0, 'pendingCount must drain after completion');
  console.log('[unit] input admit-sync + chain + move coalesce ok');
}

async function testInputKeyDefsIncludeEditingKeys(): Promise<void> {
  const downs: string[] = [];
  const ups: string[] = [];
  const inserts: string[] = [];

  const page = {
    mouse: { move: async () => {}, down: async () => {}, up: async () => {}, wheel: async () => {} },
    keyboard: {
      down: async (k: string) => { downs.push(k); },
      up:   async (k: string) => { ups.push(k); },
      type: async () => { throw new Error('keyboard.type must not be used'); },
    },
    goBack:    () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
    evaluate:  async () => null,
  };
  const cdp = {
    send: async (method: string, params?: { text?: string }) => {
      if (method === 'Input.insertText' && params?.text) inserts.push(params.text);
    },
  };
  const { InputController } = await import('./browser/patchright/Input');
  const { PatchrightInputBackend } = await import('./browser/patchright/input/PatchrightInputBackend');
  const input = new InputController(page as never, new PatchrightInputBackend(page as never, cdp as never));

  input.enqueue({ type: 'keydown', key: 'Backspace' });
  input.enqueue({ type: 'keyup',   key: 'Backspace' });
  input.enqueue({ type: 'keydown', key: 'Delete' });
  input.enqueue({ type: 'keydown', key: 'ArrowLeft' });
  input.enqueue({ type: 'keydown', key: 'Home' });
  input.enqueue({ type: 'keydown', key: 'Enter' });
  input.enqueue({ type: 'keydown', key: 'ã' });
  input.enqueue({ type: 'text', text: 'olá' });
  await new Promise<void>((r) => setTimeout(r, 30));

  assert.ok(downs.includes('Backspace'), 'Backspace routed to keyboard.down');
  assert.ok(ups.includes('Backspace'),   'Backspace keyup routed to keyboard.up');
  assert.ok(downs.includes('Delete'),    'Delete routed');
  assert.ok(downs.includes('ArrowLeft'), 'ArrowLeft routed');
  assert.ok(downs.includes('Home'),      'Home routed');
  assert.ok(downs.includes('Enter'),     'Enter routed');
  assert.ok(inserts.includes('ã'),       'non-ASCII keydown via Input.insertText');
  assert.ok(inserts.includes('olá'),     'text via Input.insertText');

  const upsBefore = ups.length;
  input.enqueue({ type: 'keyup', key: 'ã' });
  await new Promise<void>((r) => setTimeout(r, 20));
  assert.strictEqual(ups.length, upsBefore, 'keyup of non-ASCII must be ignored');

  console.log('[unit] input key routing (keyboard.down/up + insertText) ok');
}

async function testTouchMoveCoalesceAndStormWrites(): Promise<void> {
  const { InputController } = await import('./browser/patchright/Input');
  const { TouchMoveCoalescer } = await import('./browser/patchright/input/TouchMoveCoalescer');

  let flushes = 0;
  let lastLen = 0;
  const coalescer = new TouchMoveCoalescer((pts) => {
    flushes++;
    lastLen = pts.length;
  });
  coalescer.queue([{ id: 1, x: 1, y: 1 }]);
  coalescer.queue([{ id: 1, x: 2, y: 2 }, { id: 2, x: 3, y: 3 }]);
  coalescer.queue([{ id: 1, x: 9, y: 9 }]);
  await new Promise<void>((r) => setImmediate(r));
  assert.strictEqual(flushes, 1, 'touchmove must coalesce to one flush per turn');
  assert.strictEqual(lastLen, 1, 'latest touchmove sample wins');

  const stolen = (() => {
    const c = new TouchMoveCoalescer(() => {
      throw new Error('cancelled flush must not run');
    });
    c.queue([{ id: 1, x: 1, y: 1 }]);
    const pending = c.takePending();
    assert.ok(pending && pending[0]!.x === 1);
    return pending;
  })();
  await new Promise<void>((r) => setImmediate(r));
  assert.ok(stolen);

  let moves = 0;
  let downs = 0;
  let evaluates = 0;
  const page = {
    mouse: { move: async () => {}, down: async () => {}, up: async () => {}, wheel: async () => {} },
    keyboard: { down: async () => {}, up: async () => {}, type: async () => {} },
    goBack: () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
    evaluate: async () => {
      evaluates++;
      return null;
    },
  };
  const backend = {
    move: async () => {
      moves++;
    },
    down: async () => {
      downs++;
    },
    up: async () => {},
    wheel: async () => {},
    keyDown: async () => {},
    keyUp: async () => {},
    typeText: async () => {},
    touch: async () => {},
    dispose: async () => {},
  };
  const input = new InputController(page as never, backend);
  for (let i = 0; i < 200; i++) {
    input.enqueue({ type: 'mousemove', x: i, y: i });
  }
  input.enqueue({ type: 'mousedown', x: 1, y: 1, button: 0 });
  assert.strictEqual(moves, 0, 'admit path must stay sync (no await on enqueue)');
  assert.strictEqual(downs, 0, 'admit path must not await inject');
  await new Promise<void>((r) => setImmediate(r));
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.ok(moves <= 2, `move storm must coalesce (got ${moves} writes)`);
  assert.strictEqual(downs, 1, 'mousedown still injects once');
  assert.strictEqual(evaluates, 0, 'production hot path must not page.evaluate');
  console.log('[unit] touch coalesce + move-storm write bound ok');
}

async function testInputMousePressReleaseOrdered(): Promise<void> {
  const order: string[] = [];
  let resolveDown: (() => void) | null = null;
  const slowDown = new Promise<void>((r) => { resolveDown = r; });

  const page = {
    mouse: {
      move: async () => { throw new Error('page.mouse must not be used'); },
      down: async () => { throw new Error('page.mouse must not be used'); },
      up:   async () => { throw new Error('page.mouse must not be used'); },
      wheel: async () => {},
    },
    keyboard: { down: async () => {}, up: async () => {}, type: async () => {} },
    goBack:    () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
    evaluate:  async () => null,
  };
  const cdp = {
    send: async (_method: string, params?: { type?: string }) => {
      if (params?.type === 'mousePressed') {
        order.push('down');
        await slowDown;
        return;
      }
      if (params?.type === 'mouseReleased') order.push('up');
    },
  };
  const { InputController } = await import('./browser/patchright/Input');
  const { PatchrightInputBackend } = await import('./browser/patchright/input/PatchrightInputBackend');
  const input = new InputController(page as never, new PatchrightInputBackend(page as never, cdp as never));

  input.enqueue({ type: 'mousedown', x: 10, y: 10, button: 0 });
  input.enqueue({ type: 'mouseup',   x: 10, y: 10, button: 0 });

  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.ok(order.includes('down'), 'mousedown must have started');
  assert.ok(!order.includes('up'),  'mouseup must be held until mousedown completes');

  resolveDown!();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(order.indexOf('down') < order.indexOf('up'), 'down must precede up');
  console.log('[unit] input mouse press/release order ok');
}

async function testInputPendingCountIncludesChainDepth(): Promise<void> {
  let resolveDown: (() => void) | null = null;
  const slowDown = new Promise<void>((r) => { resolveDown = r; });
  const page = {
    mouse: { move: async () => {}, down: async () => {}, up: async () => {}, wheel: async () => {} },
    keyboard: { down: async () => {}, up: async () => {}, type: async () => {} },
    goBack: () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
    evaluate: async () => null,
  };
  const backend = {
    move: async () => {},
    down: async () => { await slowDown; },
    up: async () => {},
    wheel: async () => {},
    keyDown: async () => {},
    keyUp: async () => {},
    typeText: async () => {},
    touch: async () => {},
    dispose: async () => {},
  };
  const { InputController } = await import('./browser/patchright/Input');
  const input = new InputController(page as never, backend);
  input.enqueue({ type: 'mousedown', x: 1, y: 1, button: 0 });
  input.enqueue({ type: 'mouseup', x: 1, y: 1, button: 0 });
  await Promise.resolve();
  assert.strictEqual(input.pendingCount, 2, 'pendingCount must include queued chain work');
  assert.strictEqual(input.chainDepth, 2, 'chainDepth must reflect queued inject operations');
  resolveDown!();
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(input.pendingCount, 0, 'pendingCount must drain after inject completes');
  console.log('[unit] input pending count includes chain depth ok');
}

async function testTelemetryToggleOmission(): Promise<void> {
  const registry = { list: () => [] };
  const empty = await collectTelemetry({}, registry as never);
  assert.deepStrictEqual(empty, {});

  const processOnly = await collectTelemetry({ includeProcess: true }, registry as never);
  assert.ok(processOnly.process);
  assert.strictEqual(processOnly.eventLoop, undefined);
  assert.strictEqual(processOnly.chrome, undefined);
  assert.strictEqual(processOnly.queues, undefined);
  assert.strictEqual(processOnly.sessions, undefined);

  const sectioned = await collectTelemetry({ includeChrome: true, includeQueues: true }, registry as never) as {
    chrome?: { totalJsHeapUsed?: number };
    queues?: { inputDepth?: number; inputChainDepth?: number; droppedTotal?: number };
  };
  assert.ok(sectioned.chrome);
  assert.ok(sectioned.queues);
  assert.strictEqual('totalJsHeapUsed' in sectioned.chrome!, false);
  assert.strictEqual(sectioned.queues!.inputDepth, 0);
  assert.strictEqual(sectioned.queues!.inputChainDepth, 0);
  assert.strictEqual(sectioned.queues!.droppedTotal, 0);
  console.log('[unit] telemetry toggles omit sections ok');
}

async function testTelemetryQueuesReportInputDepthAndDrops(): Promise<void> {
  const bridge = new EventBridge('telemetry-session');
  bridge.video.tryWrite(new Uint8Array([1]));
  bridge.video.tryWrite(new Uint8Array([2]));
  bridge.video.tryWrite(new Uint8Array([3]));
  const registry = {
    list: () => [
      {
        bridge,
        session: {
          sessionId: 'telemetry-session',
          getStatus: async () => ({
            isOpen: true,
            tabCount: 1,
            url: 'about:blank',
            resizing: false,
            width: 390,
            height: 844,
            displayWidth: 4096,
            displayHeight: 2160,
            chromeWidth: 390,
            chromeHeight: 844,
          }),
          getTelemetrySnapshot: () => ({
            inputPendingCount: 2,
            inputChainDepth: 1,
            displayAllocated: true,
            displayWidth: 4096,
            displayHeight: 2160,
            logicalWidth: 390,
            logicalHeight: 844,
            chromeWidth: 390,
            chromeHeight: 844,
            inputBackend: 'os',
            touchPrimary: true,
            userDataDirPresent: true,
          }),
        },
      },
    ],
  };
  const sample = await collectTelemetry({ includeQueues: true }, registry as never) as {
    queues?: { videoDepth: number; inputDepth?: number; inputChainDepth?: number; droppedTotal?: number };
  };
  assert.deepStrictEqual(sample.queues, {
    videoDepth: 2,
    audioDepth: 0,
    consoleDepth: 0,
    inputDepth: 2,
    inputChainDepth: 1,
    droppedTotal: 1,
  });
  console.log('[unit] telemetry queues report input depth and drops ok');
}

async function testTelemetryFaultStateSurvivesCrashConsumption(): Promise<void> {
  const bridge = new EventBridge('faulted-session');
  bridge.onCrash({
    errorCode: 'browser_closed',
    message: 'Chrome context closed unexpectedly',
    phase: 'runtime',
  });
  const consumed = await bridge.crash.read();
  assert.ok(consumed);
  assert.strictEqual(bridge.crash.pendingCount, 0);

  const registry = {
    list: () => [{
      bridge,
      session: {
        sessionId: 'faulted-session',
        getStatus: async () => ({ isOpen: false, tabCount: 0 }),
      },
    }],
  };

  const telemetry = await collectTelemetry(
    { includeSessionsSummary: true, includeFaultedIds: true },
    registry as never,
  ) as {
    sessions?: { faulted: number; faultedSessionIds: string[] };
  };

  assert.strictEqual(telemetry.sessions?.faulted, 1);
  assert.deepStrictEqual(telemetry.sessions?.faultedSessionIds, ['faulted-session']);
  console.log('[unit] telemetry fault state survives crash consumption ok');
}

async function testTelemetryAllocationsSummaryAndSessions(): Promise<void> {
  const bridge = new EventBridge('alloc-session');
  const registry = {
    list: () => [{
      bridge,
      session: {
        sessionId: 'alloc-session',
        getStatus: async () => ({
          isOpen: true,
          tabCount: 1,
          url: 'about:blank',
          resizing: false,
          width: 390,
          height: 844,
          displayWidth: 4096,
          displayHeight: 2160,
          chromeWidth: 390,
          chromeHeight: 844,
        }),
        getTelemetrySnapshot: () => ({
          displayAllocated: true,
          displayWidth: 4096,
          displayHeight: 2160,
          logicalWidth: 390,
          logicalHeight: 844,
          chromeWidth: 390,
          chromeHeight: 844,
          inputBackend: 'os',
          touchPrimary: false,
          userDataDirPresent: true,
        }),
      },
    }],
  };

  const summaryOnly = await collectTelemetry(
    { includeAllocationsSummary: true },
    registry as never,
  ) as {
    allocations?: {
      summary?: {
        allocatedSessions: number;
        allocatedDisplayPixels: number;
        osInputSessions: number;
      };
      sessions?: unknown[];
    };
  };
  assert.strictEqual(summaryOnly.allocations?.summary?.allocatedSessions, 1);
  assert.strictEqual(summaryOnly.allocations?.summary?.allocatedDisplayPixels, 4096 * 2160);
  assert.strictEqual(summaryOnly.allocations?.summary?.osInputSessions, 1);
  assert.strictEqual(summaryOnly.allocations?.sessions, undefined);

  const withSessions = await collectTelemetry(
    { includeAllocationsSummary: true, includeAllocationSessions: true },
    registry as never,
  ) as {
    allocations?: {
      sessions?: Array<{ sessionId: string; displayAllocated: boolean; inputBackend: string }>;
    };
  };
  assert.strictEqual(withSessions.allocations?.sessions?.length, 1);
  assert.strictEqual(withSessions.allocations?.sessions?.[0]?.sessionId, 'alloc-session');
  assert.strictEqual(withSessions.allocations?.sessions?.[0]?.displayAllocated, true);
  assert.strictEqual(withSessions.allocations?.sessions?.[0]?.inputBackend, 'os');
  console.log('[unit] telemetry allocations summary and sessions ok');
}

function testLogicalToDeviceTransform(): void {
  const { createCoordTransform, mapLogicalToAbs } = require('./browser/patchright/input/logical-to-device') as typeof import('./browser/patchright/input/logical-to-device');
  const t = createCoordTransform(100, 200, 999, 1999);
  assert.deepStrictEqual(mapLogicalToAbs(t, 0, 0), { x: 0, y: 0 });
  assert.deepStrictEqual(mapLogicalToAbs(t, 100, 200), { x: 999, y: 1999 });
  assert.deepStrictEqual(mapLogicalToAbs(t, 50, 100), { x: 500, y: 1000 });
  assert.deepStrictEqual(mapLogicalToAbs(t, -10, 500), { x: 0, y: 1999 });
  console.log('[unit] logical-to-device transform ok');
}

function testKeycodeResolve(): void {
  const { resolveKeyStroke, KEY } = require('./browser/patchright/input/keycodes') as typeof import('./browser/patchright/input/keycodes');
  assert.strictEqual(resolveKeyStroke('Enter')?.code, KEY.ENTER);
  assert.strictEqual(resolveKeyStroke('a')?.code, KEY.A);
  assert.strictEqual(resolveKeyStroke('A')?.shift, true);
  assert.strictEqual(resolveKeyStroke(''), null);
  assert.strictEqual(resolveKeyStroke('Unobtanium'), null);
  console.log('[unit] keycode resolve ok');
}

function testXorgInputIsolationFlags(): void {
  const { buildXorgDummyConfigForTest } = require('./browser/patchright/Display') as typeof import('./browser/patchright/Display');
  const hotplug = buildXorgDummyConfigForTest(1280, 720);
  assert.ok(hotplug.includes('Option "AutoAddDevices" "true"'), 'patchright path keeps AutoAdd');
  assert.ok(hotplug.includes('Option "AutoEnableDevices" "false"'), 'foreign devices not auto-enable');

  const bound = buildXorgDummyConfigForTest(1280, 720, {
    pointerEventPath: '/dev/input/event4',
    keyboardEventPath: '/dev/input/event6',
    touchEventPath: '/dev/input/event5',
    pointerName: 'speculum-ptr-test',
    keyboardName: 'speculum-kbd-test',
    touchName: 'speculum-mt-test',
  });
  assert.ok(bound.includes('Option "AutoAddDevices" "false"'), 'os path disables AutoAdd');
  assert.ok(bound.includes('Driver "evdev"'), 'os path binds evdev');
  assert.ok(bound.includes('Option "Device" "/dev/input/event4"'), 'pointer event bound');
  assert.ok(bound.includes('Option "Device" "/dev/input/event6"'), 'keyboard event bound');
  assert.ok(bound.includes('Option "Device" "/dev/input/event5"'), 'touch event bound');
  assert.ok(bound.includes('InputDevice "speculum-ptr-test" "CorePointer"'), 'pointer in layout');
  assert.ok(
    bound.includes('InputDevice "speculum-kbd-test" "CoreKeyboard"'),
    'keyboard in layout',
  );
  const ptrSection = bound
    .split(/Section "InputDevice"/)
    .find((s) => s.includes('Identifier "speculum-ptr-test"'));
  assert.ok(ptrSection && !ptrSection.includes('Mode" "Absolute"'), 'pointer is relative');
  assert.ok(
    ptrSection.includes('AccelerationScheme" "none"'),
    'pointer acceleration disabled for software cursor',
  );
  console.log('[unit] xorg input isolation flags ok');
}

/** Regression: koffi variadic ioctl(fd, req, arg) throws; fixed 3-arg prototype must not. */
function testIoctlKoffiPrototype(): void {
  if (process.platform !== 'linux') {
    console.log('[unit] ioctl koffi prototype skip (non-linux)');
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi');
  const libc = koffi.load('libc.so.6');
  const bad = libc.func('int ioctl(int fd, unsigned long request, ...)');
  assert.throws(
    () => bad(0, 0x5501, 0),
    (err: unknown) =>
      err instanceof Error && /Missing value argument for variadic call/.test(err.message),
  );
  const good = libc.func('int ioctl(int fd, unsigned long request, int arg)');
  const rc = good(0, 0x5501, 0);
  assert.strictEqual(typeof rc, 'number');
  console.log('[unit] ioctl koffi prototype ok');
}

async function main(): Promise<void> {
  // Debug instrumentation posts to the ingest server; don't hang unit runs on it.
  (globalThis as { fetch: typeof fetch }).fetch = (async () =>
    new Response('{}', { status: 204 })) as typeof fetch;

  testDomainMatch();
  testScriptTargetRuleMatch();
  testPermissiveMainFrameCspRewrite();
  testViewportBounds();
  testResolveDeviceProfileDefaults();
  await testApplyLogicalViewportUsesDeviceMetricsOnly();
  await testProveLogicalViewportUsesCssLayoutMetrics();
  testBuildChromeArgsIncludesWebglSpoof();
  await testScreencastRestartThrowsAfterStop();
  testLaunchEnvironmentIsRequired();
  testTouchEmulationParams();
  testStopDoesNotEnqueueCrash();
  testUnexpectedContextCloseEnqueuesCrash();
  testRecreateKeepsOpenAcrossStaleClose();
  await testStopKeepsBridgeQueuesOpen();
  testBenignBrowserRaceNarrow();
  await testAbortDoesNotStealQueuedCrash();
  testDropOldestQueueTracksDroppedCount();
  await testPermissionClearRespectsEpoch();
  testLogicalToDeviceTransform();
  testKeycodeResolve();
  testXorgInputIsolationFlags();
  testIoctlKoffiPrototype();
  await testInputFireAndForgetAndMoveCoalesce();
  await testInputKeyDefsIncludeEditingKeys();
  await testTouchMoveCoalesceAndStormWrites();
  await testInputMousePressReleaseOrdered();
  await testInputPendingCountIncludesChainDepth();
  await testTelemetryToggleOmission();
  await testTelemetryQueuesReportInputDepthAndDrops();
  await testTelemetryFaultStateSurvivesCrashConsumption();
  await testTelemetryAllocationsSummaryAndSessions();
  testHostResourcesApplySkipsRemountOffLinux();
  testCookieSanitizeMatrix();
  console.log('[unit] all passed');
}

function testCookieSanitizeMatrix(): void {
  const dirty: BrowserCookieState = {
    name: 'sf_marker',
    value: 'state-cookie',
    domain: 'fixture.test',
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: '',
  };
  const clean = sanitizeCookieForCdp(dirty);
  assert.ok(clean);
  assert.strictEqual(clean!.name, 'sf_marker');
  assert.strictEqual('expires' in clean!, false);
  assert.strictEqual('sameSite' in clean!, false);

  const ms = sanitizeCookieForCdp({
    name: 'ms',
    value: 'v',
    domain: 'd.com',
    path: '/',
    expires: 1_700_000_000_000,
  });
  assert.strictEqual(ms!.expires, 1_700_000_000);

  const none = sanitizeCookieForCdp({
    name: 'x',
    value: '1',
    domain: 'd.com',
    path: '/',
    secure: false,
    sameSite: 'none',
  });
  assert.strictEqual(none!.sameSite, 'None');
  assert.strictEqual(none!.secure, true);

  assert.strictEqual(sanitizeCookieForCdp({
    name: '',
    value: '1',
    domain: 'd.com',
    path: '/',
  }), null);

  const batch = sanitizeCookieBatch([
    { name: 'good', value: '1', domain: 'd.com', path: '/' },
    { name: '', value: 'bad', domain: 'd.com', path: '/' },
    { name: 'ok', value: '2', domain: 'd.com', path: '/', sameSite: 'LAX', expires: -1 },
  ]);
  assert.strictEqual(batch.valid.length, 2);
  assert.strictEqual(batch.skippedCount, 1);
  assert.ok(batch.normalizedCount >= 1);
  console.log('[unit] cookie sanitize ok');
}

function testHostResourcesApplySkipsRemountOffLinux(): void {
  if (process.platform === 'linux') {
    console.log('[unit] host resources remount skip (linux — exercised in container)');
    return;
  }
  const result = applyHostResources({
    shmSizeBytes: 4 * 1024 * 1024 * 1024,
    raiseUlimits: true,
    nofile: 4096,
    nproc: 1024,
  });
  assert.ok(result.warnings.some((w) => /shm remount skipped/i.test(w)));
  assert.strictEqual(result.ulimitsRaised, false);
  console.log('[unit] host resources apply skip off-linux ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
