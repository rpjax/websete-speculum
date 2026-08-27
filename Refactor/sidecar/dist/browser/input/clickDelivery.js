"use strict";
/**
 * Click delivery — live-node resolve only (sparse-cdp).
 *
 * OS census-coordinated delivery was removed with the PP OS input stack
 * (decision-log.md 2026-08-27). Client hit-tests a nodeId; Virtual resolves the live
 * viewport point; EventApplier dispatches there. `nodeId == null` is handled by the
 * caller (raw-coordinate fallback), not this strategy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.liveNodeResolveClickDelivery = liveNodeResolveClickDelivery;
function liveNodeResolveClickDelivery(resolveClickTarget) {
    return { mode: 'live-node-resolve', resolveClickTarget };
}
//# sourceMappingURL=clickDelivery.js.map