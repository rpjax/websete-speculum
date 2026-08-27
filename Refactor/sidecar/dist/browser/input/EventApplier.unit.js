"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEventApplierUnitTests = runEventApplierUnitTests;
const assert_1 = __importDefault(require("assert"));
const EventApplier_1 = require("./EventApplier");
const SidecarBuffer_1 = require("./SidecarBuffer");
const clickDelivery_1 = require("./clickDelivery");
async function runEventApplierUnitTests() {
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
        clickDelivery: (0, clickDelivery_1.liveNodeResolveClickDelivery)(async () => assert_1.default.fail('move must not reach click delivery')),
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
    // nodeId resolves to a live point
    const moves3 = [];
    const buttons3 = [];
    const resolveCalls = [];
    const applierResolve = new EventApplier_1.EventApplier({
        buffer: new SidecarBuffer_1.SidecarBuffer(),
        pointer: {
            moveTo: (x, y) => moves3.push({ x, y }),
            button: (btn, down) => buttons3.push({ btn, down }),
            sanitize: () => { },
        },
        keyboard: { key: () => { }, sanitize: () => { } },
        activeViewport: () => ({ w: 800, h: 600 }),
        clickDelivery: (0, clickDelivery_1.liveNodeResolveClickDelivery)(async (contextId, nodeId) => {
            resolveCalls.push({ contextId, nodeId });
            return { ok: true, x: 111, y: 222 };
        }),
    });
    applierResolve.enqueue({
        schemaVersion: 1,
        type: 'down',
        viewportW: 800,
        viewportH: 600,
        x: 10,
        y: 20,
        button: 'left',
        contextId: 3,
        nodeId: 42,
    });
    await applierResolve.flush();
    assert_1.default.deepStrictEqual(resolveCalls, [{ contextId: 3, nodeId: 42 }]);
    assert_1.default.deepStrictEqual(moves3[0], { x: 111, y: 222 }, 'must dispatch at the resolved point, not the raw hit-test coord');
    assert_1.default.ok(buttons3.some((b) => b.btn === 'left' && b.down === true));
    // resolve failure → reject, no dispatch
    const rejects2 = [];
    const applierResolveFail = new EventApplier_1.EventApplier({
        buffer: new SidecarBuffer_1.SidecarBuffer(),
        pointer: {
            moveTo: () => assert_1.default.fail('unresolved nodeId must not move'),
            button: () => assert_1.default.fail('unresolved nodeId must not click'),
            sanitize: () => { },
        },
        keyboard: { key: () => { }, sanitize: () => { } },
        activeViewport: () => ({ w: 800, h: 600 }),
        clickDelivery: (0, clickDelivery_1.liveNodeResolveClickDelivery)(async () => ({ ok: false, reason: 'node_not_found' })),
        onReject: (code) => rejects2.push(code),
    });
    applierResolveFail.enqueue({
        schemaVersion: 1,
        type: 'down',
        viewportW: 800,
        viewportH: 600,
        x: 10,
        y: 20,
        button: 'left',
        contextId: 1,
        nodeId: 99,
    });
    await applierResolveFail.flush();
    assert_1.default.ok(rejects2.includes('resolve_click_failed:node_not_found'));
    // No nodeId → dispatch at raw client coordinate
    const moves4 = [];
    const applierNoTarget = new EventApplier_1.EventApplier({
        buffer: new SidecarBuffer_1.SidecarBuffer(),
        pointer: {
            moveTo: (x, y) => moves4.push({ x, y }),
            button: () => { },
            sanitize: () => { },
        },
        keyboard: { key: () => { }, sanitize: () => { } },
        activeViewport: () => ({ w: 800, h: 600 }),
        clickDelivery: (0, clickDelivery_1.liveNodeResolveClickDelivery)(async () => assert_1.default.fail('must not call resolve when nodeId is null')),
    });
    const downNull = {
        schemaVersion: 1,
        type: 'down',
        viewportW: 800,
        viewportH: 600,
        x: 50,
        y: 60,
        button: 'left',
        contextId: 1,
        nodeId: null,
    };
    applierNoTarget.enqueue(downNull);
    await applierNoTarget.flush();
    assert_1.default.deepStrictEqual(moves4[0], { x: 50, y: 60 });
    console.log('[unit] EventApplier live-node-resolve ok');
}
//# sourceMappingURL=EventApplier.unit.js.map