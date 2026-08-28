import assert from 'assert';
import {
  SparseCdpKeyboardPeripheral,
  SparseCdpPointerPeripheral,
  openSparseCdpInputAdapter,
  type SparseCdpKeyboardActions,
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

function fakeKeyboard() {
  const downs: string[] = [];
  const ups: string[] = [];
  const actions: SparseCdpKeyboardActions = {
    down: async (key) => {
      downs.push(key);
    },
    up: async (key) => {
      ups.push(key);
    },
  };
  return { actions, downs, ups };
}

export async function runSparseCdpInputAdapterUnitTests(): Promise<void> {
  await testClickDispatchesMoveDownUp();
  await testContinuousMoveRejectedAsNoOp();
  await testBackToBackClicksAtDistinctTargetsKeepOwnCoords();
  await testEditingKeysUsePlaywrightKeyboard();
  await testNonAsciiCharUsesInsertText();
  await testAsciiPrintableUsesPlaywrightKeyboard();
  await testArrowKeyUsesPlaywrightKeyboard();
  testFactoryShapeAndDisplayInputDevicesStub();
  console.log('[unit] sparseCdpInputAdapter catalog ok');
}

async function testClickDispatchesMoveDownUp(): Promise<void> {
  const cdp = fakeCdp();
  const pointer = new SparseCdpPointerPeripheral(cdp.send);

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

  pointer.moveTo(1, 1);
  pointer.moveTo(2, 2);
  pointer.moveTo(3, 3);
  await pointer.flush();

  assert.strictEqual(cdp.calls.length, 1, 'only the first bare move is dispatched');
  assert.strictEqual(pointer.rejectedContinuousMoveCount, 2, 'the 2nd/3rd bare moves are no-op rejected');

  pointer.button('left', true);
  pointer.moveTo(4, 4);
  await pointer.flush();
  assert.strictEqual(cdp.calls.length, 3, 'move after button() is a fresh gesture, not rejected');
}

async function testEditingKeysUsePlaywrightKeyboard(): Promise<void> {
  const cdp = fakeCdp();
  const kb = fakeKeyboard();
  const keyboard = new SparseCdpKeyboardPeripheral(cdp.send, kb.actions);

  for (const key of ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete']) {
    keyboard.key(key, true);
    keyboard.key(key, false);
  }
  await keyboard.flush();

  assert.strictEqual(cdp.calls.length, 0, 'named keys must not use insertText/dispatchKeyEvent directly');
  assert.deepStrictEqual(kb.downs, ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete']);
  assert.deepStrictEqual(kb.ups, ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete']);
  assert.strictEqual(keyboard.rejectedKeyCount, 0);
}

async function testNonAsciiCharUsesInsertText(): Promise<void> {
  const cdp = fakeCdp();
  const kb = fakeKeyboard();
  const keyboard = new SparseCdpKeyboardPeripheral(cdp.send, kb.actions);

  keyboard.key('é', true);
  keyboard.key('é', false);
  await keyboard.flush();

  assert.strictEqual(cdp.calls.length, 1, 'non-ASCII = one insertText on the down edge, no call on up');
  assert.deepStrictEqual(cdp.calls[0], { method: 'Input.insertText', params: { text: 'é' } });
  assert.strictEqual(kb.downs.length, 0);
}

async function testAsciiPrintableUsesPlaywrightKeyboard(): Promise<void> {
  const cdp = fakeCdp();
  const kb = fakeKeyboard();
  const keyboard = new SparseCdpKeyboardPeripheral(cdp.send, kb.actions);

  for (const key of ['a', ' ']) {
    keyboard.key(key, true);
    keyboard.key(key, false);
  }
  await keyboard.flush();

  assert.strictEqual(cdp.calls.length, 0, 'ASCII printable must use page.keyboard, not insertText');
  assert.deepStrictEqual(kb.downs, ['a', ' ']);
  assert.deepStrictEqual(kb.ups, ['a', ' ']);
}

async function testArrowKeyUsesPlaywrightKeyboard(): Promise<void> {
  const cdp = fakeCdp();
  const kb = fakeKeyboard();
  const keyboard = new SparseCdpKeyboardPeripheral(cdp.send, kb.actions);

  keyboard.key('ArrowLeft', true);
  keyboard.key('ArrowLeft', false);
  await keyboard.flush();

  assert.strictEqual(cdp.calls.length, 0);
  assert.deepStrictEqual(kb.downs, ['ArrowLeft']);
  assert.deepStrictEqual(kb.ups, ['ArrowLeft']);
  assert.strictEqual(keyboard.rejectedKeyCount, 0);
}

function testFactoryShapeAndDisplayInputDevicesStub(): void {
  const cdp = fakeCdp();
  const kb = fakeKeyboard();
  const adapter = openSparseCdpInputAdapter({
    cdp,
    keyboard: kb.actions,
    logicalWidth: 1280,
    logicalHeight: 720,
  });

  assert.strictEqual(adapter.kind, 'sparse-cdp');
  assert.strictEqual(
    (adapter as Partial<{ displayInputDevices: unknown }>).displayInputDevices,
    undefined,
    'no kernel device at all — must not implement IDisplayInputDeviceProvider, not even a stub',
  );
  adapter.setLogicalSize(1920, 1080);
  adapter.dispose();
}
