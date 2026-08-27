"use strict";
/**
 * Input adapter factory (Fase 2.3). Sole entry point sessions use to obtain an
 * {@link IInputAdapter} — replaces the direct `AbsOsInputStack.open(...)` call that used
 * to live inline in `PageProjectionBrowserSession.launch()`.
 *
 * Fase 2: only `'os-abs'` is registered (today's sealed default, zero behaviour change).
 * Fase 3 widens this to also accept `'sparse-cdp'` (opt-in only — never an env var, see
 * docs/page-projection/spec/decision-log.md 2026-08-27).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInputAdapter = createInputAdapter;
const osAbsInputAdapter_1 = require("./adapters/osAbsInputAdapter");
const sparseCdpInputAdapter_1 = require("./adapters/sparseCdpInputAdapter");
function createInputAdapter(kind, opts) {
    if (kind === 'os-abs') {
        return (0, osAbsInputAdapter_1.openOsAbsInputAdapter)(opts);
    }
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