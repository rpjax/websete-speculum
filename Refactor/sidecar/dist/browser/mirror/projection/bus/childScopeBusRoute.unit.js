"use strict";
/**
 * Child-scope index + VirtualDomainBus O(1) fabric routing (no DOM querySelectorAll).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runChildScopeBusRouteUnitTests = runChildScopeBusRouteUnitTests;
const assert_1 = __importDefault(require("assert"));
const childScopes_1 = require("@speculum/page-projection/virtual/dom/childScopes");
const virtualDomainBus_1 = require("@speculum/page-projection/virtual/bus/virtualDomainBus");
async function runChildScopeBusRouteUnitTests() {
    testChildScopeIndexReverseAndWindowLookup();
    testChildScopeDropRemovesContext();
    await testBusUnicastUsesFabricNotQuerySelector();
    await testBusDeadContextFailClosedFast();
    console.log('[unit] child-scope bus O(1) route ok');
}
function testChildScopeIndexReverseAndWindowLookup() {
    let next = 2;
    const index = new childScopes_1.ChildScopeIndex(() => next++);
    const winA = { tag: 'A' };
    const hostA = { nodeType: 1, isConnected: true, contentWindow: winA };
    const nodes = new Map([[10, hostA]]);
    const admit = index.admit(10, hostA);
    assert_1.default.strictEqual(admit.kind, 'host');
    if (admit.kind !== 'host')
        return;
    assert_1.default.strictEqual(admit.contextId, 2);
    assert_1.default.strictEqual(index.hasContext(2), true);
    assert_1.default.strictEqual(index.nodeIdOf(2), 10);
    assert_1.default.strictEqual(index.windowOf(2, (id) => nodes.get(id)), winA);
    assert_1.default.strictEqual(index.lookupByContentWindow(winA, (id) => nodes.get(id)), 2);
    let live = 0;
    index.forEachLiveWindow((id) => nodes.get(id), (w, ctx) => {
        live += 1;
        assert_1.default.strictEqual(w, winA);
        assert_1.default.strictEqual(ctx, 2);
    });
    assert_1.default.strictEqual(live, 1);
}
function testChildScopeDropRemovesContext() {
    let next = 2;
    const index = new childScopes_1.ChildScopeIndex(() => next++);
    const winA = { tag: 'A' };
    const hostA = { nodeType: 1, isConnected: true, contentWindow: winA };
    const nodes = new Map([[10, hostA]]);
    index.admit(10, hostA);
    index.drop(10);
    assert_1.default.strictEqual(index.hasContext(2), false);
    assert_1.default.strictEqual(index.windowOf(2, (id) => nodes.get(id)), null);
}
async function testBusUnicastUsesFabricNotQuerySelector() {
    let queryCalls = 0;
    const received = [];
    const childWin = {
        postMessage: (env) => {
            received.push(env);
        },
    };
    const win = {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        document: {
            querySelectorAll: () => {
                queryCalls += 1;
                return [];
            },
        },
    };
    const bus = new virtualDomainBus_1.VirtualDomainBus({
        window: win,
        role: 'root',
        contextId: 1,
        servesRuntime: true,
    });
    bus.setChildFabric({
        windowOf: (id) => (id === 7 ? childWin : null),
        forEachLive: (fn) => fn(childWin, 7),
        hasContext: (id) => id === 7,
    });
    bus.setDeliverableCheck((id) => id === 1 || id === 7);
    bus.emit('telemetry', { kind: 'ping' }, { destination: 7 });
    assert_1.default.strictEqual(queryCalls, 0, 'must not scan DOM');
    assert_1.default.strictEqual(received.length, 1);
    assert_1.default.strictEqual(received[0].destination, 7);
    bus.dispose();
}
async function testBusDeadContextFailClosedFast() {
    const win = {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        document: {
            querySelectorAll: () => {
                throw new Error('querySelectorAll must not run');
            },
        },
    };
    const bus = new virtualDomainBus_1.VirtualDomainBus({
        window: win,
        role: 'root',
        contextId: 1,
        servesRuntime: true,
        isDeliverableDestination: (id) => id === 1,
    });
    bus.setChildFabric({
        windowOf: () => null,
        forEachLive: () => undefined,
        hasContext: () => false,
    });
    bus.setDeliverableCheck((id) => id === 1);
    const t0 = performance.now();
    const r = await bus.requestApplyScroll(99, [{ nodeId: null, scrollX: 0, scrollY: 0 }]);
    const wall = performance.now() - t0;
    assert_1.default.strictEqual(r.ok, false);
    assert_1.default.ok(r.reason === 'context_not_found' || String(r.reason).includes('context_not_found'), `expected context_not_found, got ${JSON.stringify(r)}`);
    assert_1.default.ok(wall < 200, `fail-closed must be fast, wall=${wall}`);
    bus.dispose();
}
//# sourceMappingURL=childScopeBusRoute.unit.js.map