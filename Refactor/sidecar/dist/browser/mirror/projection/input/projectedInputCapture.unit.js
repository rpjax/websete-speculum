"use strict";
/**
 * Projected input capture — sparse-cdp only (hit-test nodeId; no pointermove / census).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProjectedInputCaptureUnitTests = runProjectedInputCaptureUnitTests;
const assert_1 = __importDefault(require("assert"));
const projectedInputCapture_1 = require("@speculum/page-projection/projected/input/projectedInputCapture");
const registry_1 = require("@speculum/page-projection/projected/registry");
function fakeEventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, handler, _opts) {
            let set = listeners.get(type);
            if (!set) {
                set = new Set();
                listeners.set(type, set);
            }
            set.add(handler);
        },
        removeEventListener(type, handler, _opts) {
            listeners.get(type)?.delete(handler);
        },
        dispatch(type, event) {
            for (const h of listeners.get(type) ?? [])
                h(event);
        },
        hasListener(type) {
            return (listeners.get(type)?.size ?? 0) > 0;
        },
    };
}
function mockSurface(elementFromPoint) {
    const win = { ...fakeEventTarget(), innerWidth: 800, innerHeight: 600 };
    const doc = {
        ...fakeEventTarget(),
        defaultView: win,
        scrollingElement: null,
        elementFromPoint: elementFromPoint ?? (() => null),
    };
    const surface = { ownerDocument: doc };
    return { win, doc, surface };
}
function baseOpts(overrides) {
    return {
        contextId: 1,
        getGeneration: () => 1,
        getViewportSize: () => ({ width: 800, height: 600 }),
        isArmed: () => true,
        ...overrides,
    };
}
async function runProjectedInputCaptureUnitTests() {
    await testSparseNeverEmitsMove();
    await testSparseHitTestsNodeId();
    await testSparseMissFallsBackToNullNodeId();
    console.log('[unit] projectedInputCapture sparse ok');
}
/** Sparse must never register `pointermove` and never emit a `move` intent. */
async function testSparseNeverEmitsMove() {
    const { doc, surface } = mockSurface();
    const sent = [];
    const registry = new registry_1.PageProjectionRegistry();
    const detach = (0, projectedInputCapture_1.attachProjectedInputCapture)(surface, registry, (intent) => {
        sent.push(intent);
    }, baseOpts());
    try {
        assert_1.default.strictEqual(doc.hasListener('pointermove'), false, 'sparse must not register pointermove');
        doc.dispatch('pointermove', { clientX: 10, clientY: 10 });
        doc.dispatch('pointermove', { clientX: 20, clientY: 20 });
        await new Promise((r) => setTimeout(r, 80));
        assert_1.default.strictEqual(sent.length, 0, 'sparse must never emit move');
    }
    finally {
        detach();
    }
}
/** Hit-test resolves registry nodeId on down. */
async function testSparseHitTestsNodeId() {
    const target = {};
    const { doc, surface } = mockSurface(() => target);
    const sent = [];
    const registry = new registry_1.PageProjectionRegistry();
    registry.register(42, target);
    const detach = (0, projectedInputCapture_1.attachProjectedInputCapture)(surface, registry, (intent) => {
        sent.push(intent);
    }, baseOpts());
    try {
        doc.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 0 });
        await new Promise((r) => setTimeout(r, 10));
        assert_1.default.strictEqual(sent.length, 1);
        assert_1.default.strictEqual(sent[0].type, 'down');
        if (sent[0].type === 'down') {
            assert_1.default.strictEqual(sent[0].nodeId, 42);
            assert_1.default.strictEqual(sent[0].x, 5);
            assert_1.default.strictEqual(sent[0].y, 6);
        }
    }
    finally {
        detach();
    }
}
/** Empty-space hit falls back to `nodeId: null`. */
async function testSparseMissFallsBackToNullNodeId() {
    const { doc, surface } = mockSurface(() => null);
    const sent = [];
    const registry = new registry_1.PageProjectionRegistry();
    const detach = (0, projectedInputCapture_1.attachProjectedInputCapture)(surface, registry, (intent) => {
        sent.push(intent);
    }, baseOpts());
    try {
        doc.dispatch('pointerup', { clientX: 1, clientY: 2, button: 0 });
        await new Promise((r) => setTimeout(r, 10));
        assert_1.default.strictEqual(sent.length, 1);
        if (sent[0].type === 'up') {
            assert_1.default.strictEqual(sent[0].nodeId, null);
        }
    }
    finally {
        detach();
    }
}
//# sourceMappingURL=projectedInputCapture.unit.js.map