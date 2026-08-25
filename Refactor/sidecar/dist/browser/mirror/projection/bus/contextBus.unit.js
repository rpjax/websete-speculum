"use strict";
/**
 * ContextBus unit tests — CB-01…CB-13 coverage.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runContextBusUnitTests = runContextBusUnitTests;
const assert_1 = __importDefault(require("assert"));
const contextBus_1 = require("@speculum/page-projection/virtual/bus/contextBus");
const virtualDomainBus_1 = require("@speculum/page-projection/virtual/bus/virtualDomainBus");
const contextBusConstants_1 = require("@speculum/page-projection/core/contextBusConstants");
async function runContextBusUnitTests() {
    testEmitRequiresDestination();
    testEmitBroadcastExcludesSelf();
    testPublishControlInputUnicastToSelf();
    testProvisionalSourceEnvelopeAccepted();
    testInvokeUnicastRejectsBroadcast();
    await testLocalInvokeShortCircuit();
    await testNoHandlerResponse();
    await testInvocationIdMonotonic();
    await testDisposeRejectsPending();
    testNonCloneableThrows();
    await testSecondOnInvocationReplaces();
    console.log('ContextBus unit tests OK');
}
function testEmitRequiresDestination() {
    const sent = [];
    const bus = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: true,
        carrier: { send: (e) => sent.push(e) },
    });
    assert_1.default.throws(() => bus.emit('evt', {}, {}), TypeError);
    bus.emit('evt', { a: 1 }, { destination: 2 });
    assert_1.default.strictEqual(sent.length, 1);
    assert_1.default.strictEqual(sent[0].destination, 2);
    bus.dispose();
}
function testEmitBroadcastExcludesSelf() {
    let local = 0;
    const bus = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: true,
        carrier: { send: () => { } },
    });
    bus.onEvent('evt', () => {
        local += 1;
    });
    bus.emit('evt', {}, { destination: '*' });
    assert_1.default.strictEqual(local, 0);
    bus.dispose();
}
function testPublishControlInputUnicastToSelf() {
    let applied = false;
    const win = {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        document: { querySelectorAll: () => [] },
    };
    const bus = new virtualDomainBus_1.VirtualDomainBus({
        window: win,
        role: 'root',
        contextId: 1,
        servesRuntime: true,
        mint: () => 2,
    });
    bus.setMine(1);
    bus.onControlInput((req) => {
        if (req.contextId === 1 && req.intentType === 'input')
            applied = true;
    });
    bus.publishControlInput({ contextId: 1, intentType: 'input', nodeId: 1 });
    assert_1.default.strictEqual(applied, true, 'root Mode B control must apply on publisher context');
    bus.dispose();
}
function testProvisionalSourceEnvelopeAccepted() {
    const { isMalformedEnvelope } = require('@speculum/page-projection/virtual/bus/types');
    const { CONTEXT_BUS_CHANNEL, CONTEXT_BUS_RUNTIME } = require('@speculum/page-projection/core/contextBusConstants');
    const req = {
        channel: CONTEXT_BUS_CHANNEL,
        source: 0,
        destination: CONTEXT_BUS_RUNTIME,
        type: 'request-invocation',
        event: { invocationId: 1, name: 'getScopeId', args: {} },
    };
    const res = {
        channel: CONTEXT_BUS_CHANNEL,
        source: 1,
        destination: 0,
        type: 'invocation-response',
        event: { invocationId: 1, result: 2 },
    };
    assert_1.default.strictEqual(isMalformedEnvelope(req), false, 'provisional source request must parse');
    assert_1.default.strictEqual(isMalformedEnvelope(res), false, 'provisional dest response must parse');
}
function testInvokeUnicastRejectsBroadcast() {
    const bus = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: true,
        carrier: { send: () => { } },
    });
    assert_1.default.throws(() => bus.invoke('x', {}, { destination: '*' }), TypeError);
    assert_1.default.throws(() => bus.invoke('x', {}, { destination: -1 }), TypeError);
    bus.dispose();
}
function testLocalInvokeShortCircuit() {
    const bus = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: true,
        carrier: { send: () => assert_1.default.fail('carrier should not be used') },
    });
    bus.onInvocation('ping', () => 42);
    return bus.invoke('ping', {}, { destination: contextBusConstants_1.CONTEXT_BUS_RUNTIME }).then((r) => {
        assert_1.default.strictEqual(r.ok, true);
        if (r.ok)
            assert_1.default.strictEqual(r.value, 42);
        bus.dispose();
    });
}
function testNoHandlerResponse() {
    const bus = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: true,
        carrier: { send: () => { } },
    });
    return bus.invoke('missing', {}, { destination: contextBusConstants_1.CONTEXT_BUS_RUNTIME }).then((r) => {
        assert_1.default.strictEqual(r.ok, false);
        if (!r.ok)
            assert_1.default.strictEqual(r.error.message, 'no_handler');
        bus.dispose();
    });
}
function testInvocationIdMonotonic() {
    const sent = [];
    let src;
    const dest = new contextBus_1.ContextBus({
        contextId: 2,
        servesRuntime: false,
        carrier: {
            send: (e) => src.receive(e),
        },
    });
    dest.onInvocation('echo', (args) => args.v);
    src = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: false,
        carrier: {
            send: (e) => {
                sent.push(e);
                dest.receive(e);
            },
        },
    });
    return src.invoke('echo', { v: 'hi' }, { destination: 2, timeoutMs: 500 }).then((r) => {
        assert_1.default.strictEqual(r.ok, true);
        if (r.ok)
            assert_1.default.strictEqual(r.value, 'hi');
        const req = sent.find((e) => e.type === 'request-invocation');
        assert_1.default.ok(req);
        assert_1.default.strictEqual(req.event.invocationId, 1);
        src.dispose();
        dest.dispose();
    });
}
function testDisposeRejectsPending() {
    const bus = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: false,
        carrier: { send: () => { } },
    });
    const p = bus.invoke('x', {}, { destination: 2 });
    bus.dispose();
    return p.then((r) => {
        assert_1.default.strictEqual(r.ok, false);
        if (!r.ok)
            assert_1.default.strictEqual(r.error.name, 'BusDisposed');
    });
}
function testNonCloneableThrows() {
    const bus = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: true,
        carrier: { send: () => { } },
    });
    const fn = () => { };
    assert_1.default.throws(() => bus.emit('evt', fn, { destination: 1 }), /clone|JSON/i);
    bus.dispose();
}
function testSecondOnInvocationReplaces() {
    const bus = new contextBus_1.ContextBus({
        contextId: 1,
        servesRuntime: true,
        carrier: { send: () => { } },
    });
    bus.onInvocation('x', () => 1);
    bus.onInvocation('x', () => 2);
    return bus.invoke('x', {}, { destination: contextBusConstants_1.CONTEXT_BUS_RUNTIME }).then((r) => {
        assert_1.default.strictEqual(r.ok, true);
        if (r.ok)
            assert_1.default.strictEqual(r.value, 2);
        bus.dispose();
    });
}
//# sourceMappingURL=contextBus.unit.js.map