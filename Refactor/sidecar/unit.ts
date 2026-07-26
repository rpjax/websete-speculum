import assert from 'assert';
import { matchesAllowedDomain } from './browser/patchright/Navigation';
import { touchEmulationParams } from './browser/patchright/device-emulation';
import { validateLaunchViewport, validateResizeViewport } from './browser/patchright/viewport-bounds';
import { InputController } from './browser/patchright/Input';
import { shouldEmitContextCrash } from './browser/patchright/contextCrash';
import { toLaunchOptions } from './grpc/mappers';
import { EventBridge } from './host/EventBridge';
import { DropOldestQueue } from './host/DropOldestQueue';
import { isBenignBrowserRace } from './host/browserRace';
import type { Page, CDPSession } from 'patchright';

function testDomainMatch(): void {
  assert.strictEqual(matchesAllowedDomain('example.com', ['example.com']), true);
  assert.strictEqual(matchesAllowedDomain('www.example.com', ['*.example.com']), true);
  assert.strictEqual(matchesAllowedDomain('evil.com', ['example.com']), false);
  assert.strictEqual(matchesAllowedDomain('example.com', ['*.example.com']), false);
  console.log('[unit] domain match ok');
}

function testViewportBounds(): void {
  const invalidLaunch = validateLaunchViewport(0, 0);
  assert.strictEqual(invalidLaunch.ok, false);

  const validLaunch = validateLaunchViewport(800, 600);
  assert.strictEqual(validLaunch.ok, true);
  if (validLaunch.ok) {
    assert.strictEqual(validLaunch.width, 800);
    assert.strictEqual(validLaunch.height, 600);
  }

  const ok = validateResizeViewport(800, 600);
  assert.strictEqual(ok.ok, true);

  const tooSmall = validateResizeViewport(10, 10);
  assert.strictEqual(tooSmall.ok, false);

  const tooBig = validateResizeViewport(9000, 9000);
  assert.strictEqual(tooBig.ok, false);
  console.log('[unit] viewport bounds ok');
}

function testLaunchEnvironmentIsRequired(): void {
  assert.throws(
    () => toLaunchOptions({ width: 800, height: 600 }),
    /locale is required/,
  );

  const options = toLaunchOptions({
    width: 800,
    height: 600,
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
  // recreate: invalidate epoch, intentional close of old context
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
  console.log('[unit] recreate_keeps_open_across_stale_close ok');
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

  input.setSuspended(true);
  input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(moveCalls, 0);
  assert.strictEqual(input.suspended, true);

  input.setSuspended(false);
  input.enqueue({ type: 'mousedown', x: 3, y: 4, button: 0 });
  await new Promise((r) => setImmediate(r));
  // mousedown does move then down
  assert.ok(moveCalls >= 1);
  console.log('[unit] navigate_suspends_input ok');
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
  testLaunchEnvironmentIsRequired();
  testTouchEmulationParams();
  testStopDoesNotEnqueueCrash();
  testUnexpectedContextCloseEnqueuesCrash();
  testRecreateKeepsOpenAcrossStaleClose();
  await testStopKeepsBridgeQueuesOpen();
  await testNavigateSuspendsInput();
  testBenignBrowserRaceNarrow();
  await testAbortDoesNotStealQueuedCrash();
  await testPermissionClearRespectsEpoch();
  console.log('[unit] all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
