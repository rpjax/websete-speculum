"use strict";
/**
 * PageProjection input adapter factory — sparse-cdp only.
 * OS ABS (`os-abs`) was removed from the codebase (decision-log.md 2026-08-27).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInputAdapter = createInputAdapter;
const sparseCdpInputAdapter_1 = require("./adapters/sparseCdpInputAdapter");
function createInputAdapter(kind, opts) {
    if (kind === 'sparse-cdp') {
        return (0, sparseCdpInputAdapter_1.openSparseCdpInputAdapter)(opts);
    }
    throw Object.assign(new Error(`unsupported input adapter kind: "${kind}"`), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'input_adapter_kind_unsupported',
        phase: 'launch',
    });
}
//# sourceMappingURL=createInputAdapter.js.map