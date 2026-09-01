/**
 * Click delivery — live-node resolve only (sparse-cdp).
 *
 * Client hit-tests a nodeId + localX/localY ([0,1] in the target box). Virtual maps
 * those fractions onto the live element rect and returns root-viewport CSS for CDP.
 * Omit local → Virtual element center (lab helpers).
 */

export type NodeResolveResult = { ok: boolean; x?: number; y?: number; reason?: string };

export type LiveNodeResolveClickDelivery = {
  readonly mode: 'live-node-resolve';
  resolveClickTarget(
    contextId: number,
    nodeId: number,
    localX: number | undefined,
    localY: number | undefined,
  ): Promise<NodeResolveResult>;
};

export type ClickDeliveryStrategy = LiveNodeResolveClickDelivery;

export function liveNodeResolveClickDelivery(
  resolveClickTarget: (
    contextId: number,
    nodeId: number,
    localX: number | undefined,
    localY: number | undefined,
  ) => Promise<NodeResolveResult>,
): LiveNodeResolveClickDelivery {
  return { mode: 'live-node-resolve', resolveClickTarget };
}
