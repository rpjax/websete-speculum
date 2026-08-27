"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProjectedInputRuntimeGhostUnitTests = runProjectedInputRuntimeGhostUnitTests;
const assert_1 = __importDefault(require("assert"));
const projectedInputRuntime_1 = require("@speculum/page-projection/projected/input/projectedInputRuntime");
const registry_1 = require("@speculum/page-projection/projected/registry");
const scrollableIndex_1 = require("@speculum/page-projection/projected/scroll/scrollableIndex");
const frame_1 = require("@speculum/page-projection/core/frame");
const INVOKE_IDLE_TIMEOUT_MS = 2000;
function mockDoc() {
    const scrolling = { scrollTop: 0, scrollLeft: 0 };
    return {
        scrollingElement: scrolling,
        defaultView: { scrollX: 0, scrollY: 0 },
    };
}
function depsFor(contextId, doc) {
    return {
        contextId,
        getDocument: () => doc,
        getRegistry: () => new registry_1.PageProjectionRegistry(),
        getScrollIndex: () => new scrollableIndex_1.ScrollableIndex(),
    };
}
/** Projected S6 census with registry ghost (ctx id without live bus). */
async function runProjectedInputRuntimeGhostUnitTests() {
    const doc = mockDoc();
    const runtime = new projectedInputRuntime_1.ProjectedInputRuntime();
    runtime.bootstrapRoot(depsFor(frame_1.CONTEXT_ID_ROOT, doc));
    runtime.registerContext(depsFor(2, doc));
    const live = await runtime.requestScrollCensus(frame_1.CONTEXT_ID_ROOT);
    assert_1.default.strictEqual(live.ok, true, 'live root+2 census');
    runtime.unregisterContext(2);
    const ghostRegistry = runtime;
    ghostRegistry.registry.add(2);
    const t0 = performance.now();
    const ghost = await runtime.requestScrollCensus(frame_1.CONTEXT_ID_ROOT);
    const wallMs = performance.now() - t0;
    assert_1.default.strictEqual(ghost.ok, false, 'ghost registry must fail census');
    assert_1.default.ok(wallMs >= INVOKE_IDLE_TIMEOUT_MS - 50, `timeout wall=${wallMs.toFixed(0)}ms`);
    console.log('[unit] projectedInputRuntime ghost registry census timeout ok');
}
//# sourceMappingURL=projectedInputRuntimeGhost.unit.js.map