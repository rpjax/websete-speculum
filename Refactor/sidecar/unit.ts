import assert from 'assert';
import { matchesAllowedDomain } from './browser/patchright/Navigation';
import { isInputTouchPrimary, resolveDeviceProfile, deviceProfilesEqual, touchEmulationParams, DEFAULT_DESKTOP_DEVICE, applyLogicalViewport } from './browser/patchright/device-emulation';
import { validateLaunchViewport, validateResizeViewport, requireViewportPolicy } from './browser/patchright/viewport-bounds';
import { InputController } from './browser/patchright/Input';
import { shouldEmitContextCrash } from './browser/patchright/contextCrash';
import { toLaunchOptions } from './grpc/mappers';
import { EventBridge } from './host/EventBridge';
import { DropOldestQueue } from './host/DropOldestQueue';
import { isBenignBrowserRace } from './host/browserRace';
import type { Page, CDPSession } from 'patchright';

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

async function testApplyLogicalViewportUsesNormalBounds(): Promise<void> {
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

  const bounds = calls.find((c) => c.method === 'Browser.setWindowBounds');
  assert.ok(bounds, 'must set window bounds');
  assert.deepStrictEqual(bounds!.params, {
    windowId: 7,
    bounds: { left: 0, top: 0, width: 1024, height: 768, windowState: 'normal' },
  });

  const metrics = calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.ok(metrics, 'must apply device metrics');
  assert.strictEqual((metrics!.params as { width: number }).width, 1024);
  assert.strictEqual((metrics!.params as { height: number }).height, 768);
  assert.strictEqual((metrics!.params as { deviceScaleFactor: number }).deviceScaleFactor, 1);
  assert.strictEqual((metrics!.params as { screenWidth: number }).screenWidth, 1024);
  assert.strictEqual((metrics!.params as { screenHeight: number }).screenHeight, 768);

  // Soft resize path must never imply fullscreen-on-max display.
  assert.ok(
    !calls.some(
      (c) =>
        c.method === 'Browser.setWindowBounds'
        && (c.params as { bounds?: { windowState?: string } })?.bounds?.windowState === 'fullscreen',
    ),
  );

  // Desktop apply must clear UA (even after prior mobile) — no early-return skip.
  const ua = calls.find((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(ua, 'desktop apply must set/clear user agent');
  assert.strictEqual((ua!.params as { userAgent: string }).userAgent, 'Mozilla/5.0 Desktop');

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
  console.log('[unit] apply logical viewport uses normal bounds ok');
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

async function testInputDrainAwaitsInFlight(): Promise<void> {
  let resolveMove!: () => void;
  const moveGate = new Promise<void>((r) => {
    resolveMove = r;
  });
  let moveStarted = false;
  const page = {
    mouse: {
      move: async () => {
        moveStarted = true;
        await moveGate;
      },
      down: async () => {},
      up: async () => {},
      wheel: async () => {},
    },
    keyboard: {
      down: async () => {},
      up: async () => {},
      type: async () => {},
      insertText: async () => {},
    },
  } as unknown as Page;
  const cdp = { send: async () => {} } as unknown as CDPSession;
  const input = new InputController(page, cdp);
  input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(moveStarted, true);
  input.setSuspended(true);
  let drained = false;
  const drainPromise = input.drain().then(() => {
    drained = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(drained, false);
  resolveMove();
  await drainPromise;
  assert.strictEqual(drained, true);
  console.log('[unit] input drain awaits in-flight ok');
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

async function testNavigateSuspendsInput(): Promise<void> {
  let moveCalls = 0;
  const page = {
    mouse: {
      move: async () => {
        moveCalls++;
      },
      down: async () => {},
      up: async () => {},
      wheel: async () => {},
    },
    keyboard: {
      down: async () => {},
      up: async () => {},
      type: async () => {},
      insertText: async () => {},
    },
  } as unknown as Page;
  const cdp = { send: async () => {} } as unknown as CDPSession;
  const input = new InputController(page, cdp);

  input.beginSuspend();
  input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(moveCalls, 0);
  assert.strictEqual(input.suspended, true);

  input.endSuspend();
  input.enqueue({ type: 'mousedown', x: 3, y: 4, button: 0 });
  await new Promise((r) => setImmediate(r));
  // mousedown does move then down
  assert.ok(moveCalls >= 1);
  console.log('[unit] navigate_suspends_input ok');
}

async function testSuspendNestingKeepsPaused(): Promise<void> {
  let moveCalls = 0;
  const page = {
    mouse: {
      move: async () => {
        moveCalls++;
      },
      down: async () => {},
      up: async () => {},
      wheel: async () => {},
    },
    keyboard: {
      down: async () => {},
      up: async () => {},
      type: async () => {},
      insertText: async () => {},
    },
  } as unknown as Page;
  const cdp = { send: async () => {} } as unknown as CDPSession;
  const input = new InputController(page, cdp);

  input.beginSuspend(); // resize
  input.beginSuspend(); // navigate overlaps
  input.endSuspend(); // navigate ends first — must stay suspended
  assert.strictEqual(input.suspended, true);
  input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(moveCalls, 0);

  input.endSuspend(); // resize ends
  assert.strictEqual(input.suspended, false);
  input.enqueue({ type: 'mousedown', x: 3, y: 4, button: 0 });
  await new Promise((r) => setImmediate(r));
  assert.ok(moveCalls >= 1);
  console.log('[unit] suspend nesting keeps paused ok');
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

async function main(): Promise<void> {
  testDomainMatch();
  testViewportBounds();
  testResolveDeviceProfileDefaults();
  await testApplyLogicalViewportUsesNormalBounds();
  await testScreencastRestartThrowsAfterStop();
  testLaunchEnvironmentIsRequired();
  testTouchEmulationParams();
  testStopDoesNotEnqueueCrash();
  testUnexpectedContextCloseEnqueuesCrash();
  testRecreateKeepsOpenAcrossStaleClose();
  await testStopKeepsBridgeQueuesOpen();
  await testNavigateSuspendsInput();
  await testSuspendNestingKeepsPaused();
  await testInputDrainAwaitsInFlight();
  testBenignBrowserRaceNarrow();
  await testAbortDoesNotStealQueuedCrash();
  await testPermissionClearRespectsEpoch();
  console.log('[unit] all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
