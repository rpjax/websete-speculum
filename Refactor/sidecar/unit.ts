import assert from 'assert';
import { matchesAllowedDomain } from './browser/patchright/Navigation';
import { isInputTouchPrimary, resolveDeviceProfile, deviceProfilesEqual, touchEmulationParams, DEFAULT_DESKTOP_DEVICE, applyLogicalViewport } from './browser/patchright/device-emulation';
import { validateLaunchViewport, validateResizeViewport, requireViewportPolicy } from './browser/patchright/viewport-bounds';
import { shouldEmitContextCrash } from './browser/patchright/contextCrash';
import { toLaunchOptions } from './grpc/mappers';
import { EventBridge } from './host/EventBridge';
import { DropOldestQueue } from './host/DropOldestQueue';
import { isBenignBrowserRace } from './host/browserRace';
import type { CDPSession } from 'patchright';
import { collectTelemetry } from './telemetry/collectTelemetry';

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
  const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  let resolveSlow: (() => void) | null = null;
  const slow = new Promise<void>((r) => {
    resolveSlow = r;
  });

  const cdp = {
    send(method: string, params?: object): Promise<unknown> {
      sent.push({ method, params: (params ?? {}) as Record<string, unknown> });
      if (method === 'Input.dispatchMouseEvent' && (params as { type?: string })?.type === 'mousePressed') {
        return slow;
      }
      return Promise.resolve({});
    },
  };

  const page = {
    goBack: () => Promise.reject(new Error('should not block')),
    goForward: () => Promise.reject(new Error('should not block')),
  };

  const { InputController } = await import('./browser/patchright/Input');
  const input = new InputController(page as never, cdp as never);

  // Admission must return while a prior CDP call is still in flight.
  input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
  assert.strictEqual(input.pendingCount, 1, 'in-flight CDP must be visible in telemetry');
  input.enqueue({ type: 'mouseup', x: 1, y: 2, button: 0 });
  input.enqueue({ type: 'keydown', key: 'a' });
  assert.strictEqual(sent.length, 3, 'second/third CDP must not wait for first');

  // mousemove coalesces to last point via setImmediate
  input.enqueue({ type: 'mousemove', x: 10, y: 10 });
  input.enqueue({ type: 'mousemove', x: 20, y: 20 });
  input.enqueue({ type: 'mousemove', x: 30, y: 30 });
  assert.ok(input.pendingCount >= 2, 'coalesced pending move must count until flushed');
  await new Promise<void>((r) => setImmediate(r));
  const moves = sent.filter(
    (s) => s.method === 'Input.dispatchMouseEvent' && s.params.type === 'mouseMoved',
  );
  assert.strictEqual(moves.length, 1);
  assert.strictEqual(moves[0]!.params.x, 30);
  assert.strictEqual(moves[0]!.params.y, 30);

  // history must not throw / block admission
  input.enqueue({ type: 'goback' });
  input.enqueue({ type: 'goforward' });

  resolveSlow!();
  await slow;
  await Promise.resolve();
  assert.strictEqual(input.pendingCount, 0, 'telemetry input depth must drain after completion');
  console.log('[unit] input fire-and-forget + move coalesce ok');
}

async function testInputKeyDefsIncludeEditingKeys(): Promise<void> {
  const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  const cdp = {
    send: async (method: string, params?: object) => {
      sent.push({ method, params: (params ?? {}) as Record<string, unknown> });
    },
  };
  const page = {
    goBack: () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
  };
  const { InputController } = await import('./browser/patchright/Input');
  const input = new InputController(page as never, cdp as never);

  input.enqueue({ type: 'keydown', key: 'Backspace' });
  input.enqueue({ type: 'keyup', key: 'Backspace' });
  input.enqueue({ type: 'keydown', key: 'Delete' });
  input.enqueue({ type: 'keydown', key: 'ArrowLeft' });
  input.enqueue({ type: 'keydown', key: 'Home' });
  input.enqueue({ type: 'keydown', key: 'Enter' });

  const keys = sent.filter((s) => s.method === 'Input.dispatchKeyEvent');
  const backspace = keys.find((s) => s.params.key === 'Backspace' && s.params.type === 'rawKeyDown');
  assert.ok(backspace, 'Backspace must use rawKeyDown');
  assert.strictEqual(backspace!.params.windowsVirtualKeyCode, 8);
  assert.strictEqual(backspace!.params.code, 'Backspace');

  const del = keys.find((s) => s.params.key === 'Delete' && s.params.type === 'rawKeyDown');
  assert.strictEqual(del?.params.windowsVirtualKeyCode, 46);

  const arrow = keys.find((s) => s.params.key === 'ArrowLeft');
  assert.strictEqual(arrow?.params.windowsVirtualKeyCode, 37);
  assert.strictEqual(arrow?.params.code, 'ArrowLeft');

  const home = keys.find((s) => s.params.key === 'Home');
  assert.strictEqual(home?.params.windowsVirtualKeyCode, 36);

  const enter = keys.find((s) => s.params.key === 'Enter' && s.params.type === 'keyDown');
  assert.strictEqual(enter?.params.text, '\r');
  assert.strictEqual(enter?.params.windowsVirtualKeyCode, 13);

  // Shift must set modifiers on subsequent keys (selection / uppercase path).
  input.enqueue({ type: 'keydown', key: 'Shift' });
  input.enqueue({ type: 'keydown', key: 'ArrowRight' });
  const shiftArrow = sent
    .filter((s) => s.method === 'Input.dispatchKeyEvent' && s.params.key === 'ArrowRight')
    .at(-1);
  assert.strictEqual(shiftArrow?.params.modifiers, 8, 'Shift bitmask must be set');
  assert.strictEqual(shiftArrow?.params.type, 'rawKeyDown');

  console.log('[unit] input key defs (Backspace/Delete/nav/modifiers) ok');
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
    queues?: { inputDepth?: number; droppedTotal?: number };
  };
  assert.ok(sectioned.chrome);
  assert.ok(sectioned.queues);
  assert.strictEqual('totalJsHeapUsed' in sectioned.chrome!, false);
  assert.strictEqual(sectioned.queues!.inputDepth, 0);
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
          getStatus: async () => ({ isOpen: true, tabCount: 1, url: 'about:blank', resizing: false, width: 1, height: 1 }),
          getTelemetrySnapshot: () => ({ inputPendingCount: 2 }),
        },
      },
    ],
  };
  const sample = await collectTelemetry({ includeQueues: true }, registry as never) as {
    queues?: { videoDepth: number; inputDepth?: number; droppedTotal?: number };
  };
  assert.deepStrictEqual(sample.queues, {
    videoDepth: 2,
    audioDepth: 0,
    consoleDepth: 0,
    inputDepth: 2,
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
  testBenignBrowserRaceNarrow();
  await testAbortDoesNotStealQueuedCrash();
  testDropOldestQueueTracksDroppedCount();
  await testPermissionClearRespectsEpoch();
  await testInputFireAndForgetAndMoveCoalesce();
  await testInputKeyDefsIncludeEditingKeys();
  await testTelemetryToggleOmission();
  await testTelemetryQueuesReportInputDepthAndDrops();
  await testTelemetryFaultStateSurvivesCrashConsumption();
  console.log('[unit] all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
