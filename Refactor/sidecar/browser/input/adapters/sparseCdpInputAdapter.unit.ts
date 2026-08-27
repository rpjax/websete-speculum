import assert from 'assert';
import {
  SparseCdpKeyboardPeripheral,
  SparseCdpPointerPeripheral,
  openSparseCdpInputAdapter,
} from './sparseCdpInputAdapter';

type Call = { method: string; params?: object };

function fakeCdp() {
  const calls: Call[] = [];
  return {
    calls,
    send: async (method: string, params?: object): Promise<unknown> => {
      calls.push({ method, params });
      return {};
    },
  };
}

export async function runSparseCdpInputAdapterUnitTests(): Promise<void> {
  await testClickDispatchesMoveDownUp();
  await testContinuousMoveRejectedAsNoOp();
  await testBackToBackClicksAtDistinctTargetsKeepOwnCoords();
  await testNamedKeysDispatchKeyEvent();
  await testPrintableCharUsesInsertText();
  await testUnsupportedKeyRejectedAsNoOp();
  testFactoryShapeAndDisplayInputDevicesStub();
  console.log('[unit] sparseCdpInputAdapter catalog ok');
}

async function testClickDispatchesMoveDownUp(): Promise<void> {
  const cdp = fakeCdp();
  const pointer = new SparseCdpPointerPeripheral(cdp.send);

  // Mirrors EventApplier's `down` case: moveTo immediately followed by button().
  pointer.moveTo(10, 20);
  pointer.button('left', true);
  pointer.moveTo(10, 20);
  pointer.button('left', false);
  await pointer.flush();

  assert.strictEqual(cdp.calls.length, 4, 'click = move+press then move+release');
  assert.deepStrictEqual(cdp.calls[0], {
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseMoved', x: 10, y: 20 },
  });
  assert.deepStrictEqual(cdp.calls[1], {
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mousePressed', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1 },
  });
  assert.deepStrictEqual(cdp.calls[3], {
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseReleased', x: 10, y: 20, button: 'left', buttons: 0, clickCount: 1 },
  });
  assert.strictEqual(pointer.rejectedContinuousMoveCount, 0);
}

async function testBackToBackClicksAtDistinctTargetsKeepOwnCoords(): Promise<void> {
  const calls: Call[] = [];
  // Deferred send — a real CDP round trip outlives the synchronous burst of moveTo/button
  // calls `EventApplier.applyOne` fires per queued intent (its pointer API is
  // void/fire-and-forget, never awaited between intents). Regression for a bug found via
  // `input-e2e-stress` under load: reading `this.lastX/lastY` lazily inside the enqueued
  // closure raced against a later `moveTo` for a different target already overwriting them.
  const send = (method: string, params?: object): Promise<unknown> =>
    new Promise((resolve) =>
      setTimeout(() => {
        calls.push({ method, params });
        resolve({});
      }, 5),
    );
  const pointer = new SparseCdpPointerPeripheral(send);

  pointer.moveTo(10, 20);
  pointer.button('left', true);
  pointer.moveTo(10, 20);
  pointer.button('left', false);
  pointer.moveTo(300, 400);
  pointer.button('left', true);
  pointer.moveTo(300, 400);
  pointer.button('left', false);
  await pointer.flush();

  assert.strictEqual(calls.length, 8);
  const x = (i: number) => (calls[i]!.params as { x: number }).x;
  assert.strictEqual(x(1), 10, "first click's press must keep its own coords");
  assert.strictEqual(x(3), 10, "first click's release must keep its own coords");
  assert.strictEqual(x(5), 300, "second click's press must not inherit the first click's coords");
  assert.strictEqual(x(7), 300, "second click's release must not inherit the first click's coords");
}

async function testContinuousMoveRejectedAsNoOp(): Promise<void> {
  const cdp = fakeCdp();
  const pointer = new SparseCdpPointerPeripheral(cdp.send);

  // A raw `move` intent stream (no button() between calls) — hover/drag — is out of
  // catalog for this adapter (task 3.1 / input.md §7).
  pointer.moveTo(1, 1);
  pointer.moveTo(2, 2);
  pointer.moveTo(3, 3);
  await pointer.flush();

  assert.strictEqual(cdp.calls.length, 1, 'only the first bare move is dispatched');
  assert.strictEqual(pointer.rejectedContinuousMoveCount, 2, 'the 2nd/3rd bare moves are no-op rejected');

  // button() re-arms the gesture for the next click's moveTo.
  pointer.button('left', true);
  pointer.moveTo(4, 4);
  await pointer.flush();
  assert.strictEqual(cdp.calls.length, 3, 'move after button() is a fresh gesture, not rejected');
}

async function testNamedKeysDispatchKeyEvent(): Promise<void> {
  const cdp = fakeCdp();
  const keyboard = new SparseCdpKeyboardPeripheral(cdp.send);

  for (const code of ['Enter', 'Escape', 'Tab']) {
    keyboard.key(code, true);
    keyboard.key(code, false);
  }
  await keyboard.flush();

  assert.strictEqual(cdp.calls.length, 6, 'Enter/Escape/Tab each dispatch keyDown+keyUp');
  assert.deepStrictEqual(cdp.calls[0], {
    method: 'Input.dispatchKeyEvent',
    params: {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      modifiers: 0,
    },
  });
  assert.strictEqual(keyboard.rejectedKeyCount, 0);
}

async function testPrintableCharUsesInsertText(): Promise<void> {
  const cdp = fakeCdp();
  const keyboard = new SparseCdpKeyboardPeripheral(cdp.send);

  keyboard.key('a', true);
  keyboard.key('a', false);
  await keyboard.flush();

  assert.strictEqual(cdp.calls.length, 1, 'type = one insertText on the down edge, no call on up');
  assert.deepStrictEqual(cdp.calls[0], { method: 'Input.insertText', params: { text: 'a' } });
}

async function testUnsupportedKeyRejectedAsNoOp(): Promise<void> {
  const cdp = fakeCdp();
  const keyboard = new SparseCdpKeyboardPeripheral(cdp.send);

  // Multi-char code outside the catalog (e.g. ArrowLeft) — rejected, not misbehaved.
  keyboard.key('ArrowLeft', true);
  await keyboard.flush();

  assert.strictEqual(cdp.calls.length, 0, 'unsupported code must not dispatch anything');
  assert.strictEqual(keyboard.rejectedKeyCount, 1);
}

function testFactoryShapeAndDisplayInputDevicesStub(): void {
  const cdp = fakeCdp();
  const adapter = openSparseCdpInputAdapter({ cdp, logicalWidth: 1280, logicalHeight: 720 });

  assert.strictEqual(adapter.kind, 'sparse-cdp');
  assert.strictEqual(
    (adapter as Partial<{ displayInputDevices: unknown }>).displayInputDevices,
    undefined,
    'no kernel device at all — must not implement IDisplayInputDeviceProvider, not even a stub',
  );
  adapter.setLogicalSize(1920, 1080);
  adapter.dispose();
}
