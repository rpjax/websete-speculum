"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEventApplierUnitTests = runEventApplierUnitTests;
const assert_1 = __importDefault(require("assert"));
const EventApplier_1 = require("./EventApplier");
const SidecarBuffer_1 = require("./SidecarBuffer");
async function runEventApplierUnitTests() {
    const moves = [];
    const buttons = [];
    const buffer = new SidecarBuffer_1.SidecarBuffer();
    const applier = new EventApplier_1.EventApplier({
        buffer,
        pointer: {
            moveTo: (x, y) => moves.push({ x, y }),
            button: (btn, down) => buttons.push({ btn, down }),
            sanitize: () => { },
        },
        keyboard: { key: () => { }, sanitize: () => { } },
        activeViewport: () => ({ w: 800, h: 600 }),
        isPageProjection: () => true,
        applyScrollCensus: async () => ({ ok: false, error: 'fail' }),
        onReject: () => { },
    });
    const down = {
        schemaVersion: 1,
        type: 'down',
        viewportW: 800,
        viewportH: 600,
        x: 10,
        y: 20,
        button: 'left',
        census: { contexts: [] },
    };
    applier.enqueue(down);
    await new Promise((r) => setTimeout(r, 10));
    assert_1.default.strictEqual(moves.length, 0, 'Phase A fail must skip Phase B');
    assert_1.default.strictEqual(buttons.length, 0, 'Phase A fail must not press');
    const moves2 = [];
    const buttons2 = [];
    const applierOk = new EventApplier_1.EventApplier({
        buffer: new SidecarBuffer_1.SidecarBuffer(),
        pointer: {
            moveTo: (x, y) => moves2.push({ x, y }),
            button: (btn, down) => buttons2.push({ btn, down }),
            sanitize: () => { },
        },
        keyboard: { key: () => { }, sanitize: () => { } },
        activeViewport: () => ({ w: 800, h: 600 }),
        isPageProjection: () => true,
        applyScrollCensus: async () => ({ ok: true }),
    });
    applierOk.enqueue({ ...down, type: 'move' });
    applierOk.enqueue({ ...down, type: 'down' });
    await applierOk.flush();
    assert_1.default.deepStrictEqual(moves2[0], { x: 10, y: 20 });
    assert_1.default.ok(moves2.some((m) => m.x === 10 && m.y === 20));
    assert_1.default.ok(buttons2.some((b) => b.btn === 'left' && b.down === true));
    // Stale viewport stamp → drop
    const rejects = [];
    const applierStale = new EventApplier_1.EventApplier({
        buffer: new SidecarBuffer_1.SidecarBuffer(),
        pointer: {
            moveTo: () => assert_1.default.fail('stale must not move'),
            button: () => assert_1.default.fail('stale must not click'),
            sanitize: () => { },
        },
        keyboard: { key: () => { }, sanitize: () => { } },
        activeViewport: () => ({ w: 800, h: 600 }),
        isPageProjection: () => false,
        onReject: (code) => rejects.push(code),
    });
    applierStale.enqueue({
        schemaVersion: 1,
        type: 'move',
        viewportW: 1024,
        viewportH: 600,
        x: 1,
        y: 1,
    });
    await applierStale.flush();
    assert_1.default.ok(rejects.includes('stale_viewport'));
    console.log('[unit] EventApplier Phase A/B ok');
}
//# sourceMappingURL=EventApplier.unit.js.map