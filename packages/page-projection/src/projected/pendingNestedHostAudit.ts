/**
 * When nested wire may arrive before the host iframe row exists (Beleza-class redirects).
 * Desync only once the host node is known but install never completed.
 */
export function pendingNestedHostAuditMessage(
  pendingByContext: ReadonlyMap<number, number>,
  opts: {
    hasSession: (contextId: number) => boolean;
    hostNodeForContext: (contextId: number) => number | undefined;
    isHostMarked: (hostNodeId: number) => boolean;
  },
): string | null {
  for (const [contextId, queueLen] of pendingByContext) {
    if (queueLen === 0) continue;
    if (opts.hasSession(contextId)) continue;
    const hostNodeId = opts.hostNodeForContext(contextId);
    if (hostNodeId === undefined) continue;
    if (!opts.isHostMarked(hostNodeId)) {
      return `pending nested frames ctx${contextId} host node ${hostNodeId} not marked (${queueLen} queued)`;
    }
    return `pending nested frames ctx${contextId} host node ${hostNodeId} never bound (${queueLen} queued)`;
  }
  return null;
}
