"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSparseCdpInputAdapterUnitTests = runSparseCdpInputAdapterUnitTests;
const assert_1 = __importDefault(require("assert"));
const sparseCdpInputAdapter_1 = require("./sparseCdpInputAdapter");
function fakeCdp() {
    const calls = [];
    return {
        calls,
        send: async (method, params) => {
            calls.push({ method, params });
            return {};
        },
    };
}
function fakeKeyboard() {
    const downs = [];
    const ups = [];
    const actions = {
        down: async (key) => {
            downs.push(key);
        },
        up: async (key) => {
            ups.push(key);
        },
    };
    return { actions, downs, ups };
}
async function runSparseCdpInputAdapterUnitTests() {
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
async function testClickDispatchesMoveDownUp() {
    const cdp = fakeCdp();
    const pointer = new sparseCdpInputAdapter_1.SparseCdpPointerPeripheral(cdp.send);
    pointer.moveTo(10, 20);
    pointer.button('left', true);
    pointer.moveTo(10, 20);
    pointer.button('left', false);
    await pointer.flush();
    assert_1.default.strictEqual(cdp.calls.length, 4, 'click = move+press then move+release');
    assert_1.default.deepStrictEqual(cdp.calls[0], {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseMoved', x: 10, y: 20 },
    });
    assert_1.default.deepStrictEqual(cdp.calls[1], {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mousePressed', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1 },
    });
    assert_1.default.deepStrictEqual(cdp.calls[3], {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseReleased', x: 10, y: 20, button: 'left', buttons: 0, clickCount: 1 },
    });
    assert_1.default.strictEqual(pointer.rejectedContinuousMoveCount, 0);
}
async function testBackToBackClicksAtDistinctTargetsKeepOwnCoords() {
    const calls = [];
    const send = (method, params) => new Promise((resolve) => setTimeout(() => {
        calls.push({ method, params });
        resolve({});
    }, 5));
    const pointer = new sparseCdpInputAdapter_1.SparseCdpPointerPeripheral(send);
    pointer.moveTo(10, 20);
    pointer.button('left', true);
    pointer.moveTo(10, 20);
    pointer.button('left', false);
    pointer.moveTo(300, 400);
    pointer.button('left', true);
    pointer.moveTo(300, 400);
    pointer.button('left', false);
    await pointer.flush();
    assert_1.default.strictEqual(calls.length, 8);
    const x = (i) => calls[i].params.x;
    assert_1.default.strictEqual(x(1), 10, "first click's press must keep its own coords");
    assert_1.default.strictEqual(x(3), 10, "first click's release must keep its own coords");
    assert_1.default.strictEqual(x(5), 300, "second click's press must not inherit the first click's coords");
    assert_1.default.strictEqual(x(7), 300, "second click's release must not inherit the first click's coords");
}
async function testContinuousMoveRejectedAsNoOp() {
    const cdp = fakeCdp();
    const pointer = new sparseCdpInputAdapter_1.SparseCdpPointerPeripheral(cdp.send);
    pointer.moveTo(1, 1);
    pointer.moveTo(2, 2);
    pointer.moveTo(3, 3);
    await pointer.flush();
    assert_1.default.strictEqual(cdp.calls.length, 1, 'only the first bare move is dispatched');
    assert_1.default.strictEqual(pointer.rejectedContinuousMoveCount, 2, 'the 2nd/3rd bare moves are no-op rejected');
    pointer.button('left', true);
    pointer.moveTo(4, 4);
    await pointer.flush();
    assert_1.default.strictEqual(cdp.calls.length, 3, 'move after button() is a fresh gesture, not rejected');
}
async function testEditingKeysUsePlaywrightKeyboard() {
    const cdp = fakeCdp();
    const kb = fakeKeyboard();
    const keyboard = new sparseCdpInputAdapter_1.SparseCdpKeyboardPeripheral(cdp.send, kb.actions);
    for (const key of ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete']) {
        keyboard.key(key, true);
        keyboard.key(key, false);
    }
    await keyboard.flush();
    assert_1.default.strictEqual(cdp.calls.length, 0, 'named keys must not use insertText/dispatchKeyEvent directly');
    assert_1.default.deepStrictEqual(kb.downs, ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete']);
    assert_1.default.deepStrictEqual(kb.ups, ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete']);
    assert_1.default.strictEqual(keyboard.rejectedKeyCount, 0);
}
async function testNonAsciiCharUsesInsertText() {
    const cdp = fakeCdp();
    const kb = fakeKeyboard();
    const keyboard = new sparseCdpInputAdapter_1.SparseCdpKeyboardPeripheral(cdp.send, kb.actions);
    keyboard.key('é', true);
    keyboard.key('é', false);
    await keyboard.flush();
    assert_1.default.strictEqual(cdp.calls.length, 1, 'non-ASCII = one insertText on the down edge, no call on up');
    assert_1.default.deepStrictEqual(cdp.calls[0], { method: 'Input.insertText', params: { text: 'é' } });
    assert_1.default.strictEqual(kb.downs.length, 0);
}
async function testAsciiPrintableUsesPlaywrightKeyboard() {
    const cdp = fakeCdp();
    const kb = fakeKeyboard();
    const keyboard = new sparseCdpInputAdapter_1.SparseCdpKeyboardPeripheral(cdp.send, kb.actions);
    for (const key of ['a', ' ']) {
        keyboard.key(key, true);
        keyboard.key(key, false);
    }
    await keyboard.flush();
    assert_1.default.strictEqual(cdp.calls.length, 0, 'ASCII printable must use page.keyboard, not insertText');
    assert_1.default.deepStrictEqual(kb.downs, ['a', ' ']);
    assert_1.default.deepStrictEqual(kb.ups, ['a', ' ']);
}
async function testArrowKeyUsesPlaywrightKeyboard() {
    const cdp = fakeCdp();
    const kb = fakeKeyboard();
    const keyboard = new sparseCdpInputAdapter_1.SparseCdpKeyboardPeripheral(cdp.send, kb.actions);
    keyboard.key('ArrowLeft', true);
    keyboard.key('ArrowLeft', false);
    await keyboard.flush();
    assert_1.default.strictEqual(cdp.calls.length, 0);
    assert_1.default.deepStrictEqual(kb.downs, ['ArrowLeft']);
    assert_1.default.deepStrictEqual(kb.ups, ['ArrowLeft']);
    assert_1.default.strictEqual(keyboard.rejectedKeyCount, 0);
}
function testFactoryShapeAndDisplayInputDevicesStub() {
    const cdp = fakeCdp();
    const kb = fakeKeyboard();
    const adapter = (0, sparseCdpInputAdapter_1.openSparseCdpInputAdapter)({
        cdp,
        keyboard: kb.actions,
        logicalWidth: 1280,
        logicalHeight: 720,
    });
    assert_1.default.strictEqual(adapter.kind, 'sparse-cdp');
    assert_1.default.strictEqual(adapter.displayInputDevices, undefined, 'no kernel device at all — must not implement IDisplayInputDeviceProvider, not even a stub');
    adapter.setLogicalSize(1920, 1080);
    adapter.dispose();
}
//# sourceMappingURL=sparseCdpInputAdapter.unit.js.map