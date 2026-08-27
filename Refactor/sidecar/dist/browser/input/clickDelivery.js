"use strict";
/**
 * Click delivery — live-node resolve only (sparse-cdp).
 *
 * Client hit-tests a nodeId + pointer coords; Virtual validates bounds and returns the
 * live root-viewport point; EventApplier dispatches there.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.liveNodeResolveClickDelivery = liveNodeResolveClickDelivery;
function liveNodeResolveClickDelivery(resolveClickTarget) {
    return { mode: 'live-node-resolve', resolveClickTarget };
}
//# sourceMappingURL=clickDelivery.js.map