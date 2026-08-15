"use strict";
/**
 * CSSOM plane port — what resync and snapshot may call.
 * Idle scheduling lives on {@link CssomIdleScheduler}; this type is the layer boundary
 * so algorithm use cases do not import the scheduler.
 *
 * Resync always {@link CssomPlane.blockingScan} (full cost). Snapshot chooses
 * `none` | `committed` | `scan`. Live/resync emit §4.6 ops; client phase 2 CSSOM is a no-op (C6).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.disabledCssomPlane = disabledCssomPlane;
const cssomPoller_1 = require("./cssomPoller");
function disabledCssomPlane() {
    return {
        enabled: false,
        start() { },
        halt() { },
        takePending() {
            return null;
        },
        blockingScan() {
            return { ops: [], stats: (0, cssomPoller_1.emptyCssomPollStats)() };
        },
    };
}
//# sourceMappingURL=cssomPlane.js.map