"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldEmitContextCrash = shouldEmitContextCrash;
/**
 * Context 'close' decision for PatchrightBrowserSession.
 * Stale listeners (prior recreate/stop) and intentional teardown must not crash the session.
 */
function shouldEmitContextCrash(args) {
    if (args.listenerEpoch !== args.currentEpoch)
        return false;
    if (args.suppress)
        return false;
    return true;
}
//# sourceMappingURL=contextCrash.js.map