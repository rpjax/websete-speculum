"use strict";
/**
 * Projected input capture — sparse-cdp only (event.target → idOf; no pointermove / census).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProjectedInputCaptureUnitTests = runProjectedInputCaptureUnitTests;
const assert_1 = __importDefault(require("assert"));
const projectedInputCapture_1 = require("@speculum/page-projection/projected/input/projectedInputCapture");
const registry_1 = require("@speculum/page-projection/projected/registry");
const inputCaptureMetrics_1 = require("@speculum/page-projection/projected/input/inputCaptureMetrics");
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
function mockSurface() {
    const win = { ...fakeEventTarget(), innerWidth: 800, innerHeight: 600 };
    const doc = {
        ...fakeEventTarget(),
        defaultView: win,
        scrollingElement: null,
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
    await testSparseResolvesNodeIdFromEventTarget();
    await testSparseMissSkipsWhenTargetUnregistered();
    await testEditableKeyPreventDefault();
    await testHistoryShortcutEmitsNavIntent();
    console.log('[unit] projectedInputCapture sparse ok');
}
/** Sparse must never emit a `move` intent; pointermove is edge-swipe only. */
async function testSparseNeverEmitsMove() {
    const { doc, surface } = mockSurface();
    const sent = [];
    const registry = new registry_1.PageProjectionRegistry();
    const detach = (0, projectedInputCapture_1.attachProjectedInputCapture)(surface, registry, (intent) => {
        sent.push(intent);
    }, baseOpts());
    try {
        doc.dispatch('pointermove', { clientX: 10, clientY: 10 });
        doc.dispatch('pointermove', { clientX: 20, clientY: 20 });
        await new Promise((r) => setTimeout(r, 80));
        assert_1.default.strictEqual(sent.length, 0, 'sparse must never emit move');
    }
    finally {
        detach();
    }
}
/** event.target → registry.idOf on down. */
async function testSparseResolvesNodeIdFromEventTarget() {
    const target = { nodeType: 1 };
    const { doc, surface } = mockSurface();
    const sent = [];
    const registry = new registry_1.PageProjectionRegistry();
    registry.register(42, target);
    const detach = (0, projectedInputCapture_1.attachProjectedInputCapture)(surface, registry, (intent) => {
        sent.push(intent);
    }, baseOpts());
    try {
        doc.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 0, target });
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
/** Unregistered event.target → skip (fail-closed, no null nodeId intent). */
async function testSparseMissSkipsWhenTargetUnregistered() {
    const target = { nodeType: 1 };
    const { doc, surface } = mockSurface();
    const sent = [];
    const metrics = new inputCaptureMetrics_1.ProjectedInputCaptureMetrics();
    const registry = new registry_1.PageProjectionRegistry();
    const detach = (0, projectedInputCapture_1.attachProjectedInputCapture)(surface, registry, (intent) => {
        sent.push(intent);
    }, baseOpts({ metrics }));
    try {
        doc.dispatch('pointerup', { clientX: 1, clientY: 2, button: 0, target });
        await new Promise((r) => setTimeout(r, 10));
        assert_1.default.strictEqual(sent.length, 0, 'unregistered target must not enqueue');
        assert_1.default.strictEqual(metrics.snapshot().skippedNoNodeId, 1);
    }
    finally {
        detach();
    }
}
/** Editable target keys are forwarded and default action blocked (Virtual is source of truth). */
async function testEditableKeyPreventDefault() {
    const input = { nodeType: 1, tagName: 'INPUT', isContentEditable: false };
    const { doc, surface } = mockSurface();
    const sent = [];
    let prevented = false;
    const registry = new registry_1.PageProjectionRegistry();
    registry.register(7, input);
    const detach = (0, projectedInputCapture_1.attachProjectedInputCapture)(surface, registry, (intent) => {
        sent.push(intent);
    }, baseOpts());
    try {
        doc.dispatch('keydown', {
            target: input,
            key: 'a',
            code: 'KeyA',
            preventDefault: () => {
                prevented = true;
            },
            stopPropagation: () => undefined,
        });
        await new Promise((r) => setTimeout(r, 10));
        assert_1.default.ok(prevented, 'editable keydown must preventDefault');
        assert_1.default.strictEqual(sent.length, 1);
        if (sent[0].type === 'keyDown') {
            assert_1.default.strictEqual(sent[0].key, 'a');
        }
    }
    finally {
        detach();
    }
}
/** Alt+Arrow history shortcuts → historyNav intent, default blocked. */
async function testHistoryShortcutEmitsNavIntent() {
    const body = { nodeType: 1, tagName: 'BODY', isContentEditable: false };
    const { doc, surface } = mockSurface();
    const sent = [];
    let prevented = false;
    const registry = new registry_1.PageProjectionRegistry();
    const detach = (0, projectedInputCapture_1.attachProjectedInputCapture)(surface, registry, (intent) => {
        sent.push(intent);
    }, baseOpts());
    try {
        doc.dispatch('keydown', {
            target: body,
            key: 'ArrowLeft',
            code: 'ArrowLeft',
            altKey: true,
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            preventDefault: () => {
                prevented = true;
            },
            stopPropagation: () => undefined,
        });
        await new Promise((r) => setTimeout(r, 10));
        assert_1.default.ok(prevented, 'history shortcut must preventDefault');
        assert_1.default.strictEqual(sent.length, 1);
        assert_1.default.strictEqual(sent[0].type, 'historyNav');
        if (sent[0].type === 'historyNav') {
            assert_1.default.strictEqual(sent[0].direction, 'back');
        }
    }
    finally {
        detach();
    }
}
//# sourceMappingURL=projectedInputCapture.unit.js.map