/**
 * Click delivery — live-node resolve only (sparse-cdp).
 *
 * Client hit-tests a nodeId + pointer coords; Virtual validates bounds and returns the
 * live root-viewport point; EventApplier dispatches there.
 */

export type NodeResolveResult = { ok: boolean; x?: number; y?: number; reason?: string };

export type LiveNodeResolveClickDelivery = {
  readonly mode: 'live-node-resolve';
  resolveClickTarget(
    contextId: number,
    nodeId: number,
    x: number,
    y: number,
  ): Promise<NodeResolveResult>;
};

export type ClickDeliveryStrategy = LiveNodeResolveClickDelivery;

export function liveNodeResolveClickDelivery(
  resolveClickTarget: (
    contextId: number,
    nodeId: number,
    x: number,
    y: number,
  ) => Promise<NodeResolveResult>,
): LiveNodeResolveClickDelivery {
  return { mode: 'live-node-resolve', resolveClickTarget };
}
