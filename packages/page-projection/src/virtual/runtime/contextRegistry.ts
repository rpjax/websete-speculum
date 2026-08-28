/**
 * Context registry — domain identity events on ContextBus (§10.1b).
 */

import { CONTEXT_BUS_RUNTIME } from '../../core/contextBusConstants';
import type { VirtualDomainBus } from '../bus/virtualDomainBus';

export type ContextHostAdmittedEvent = {
  contextId: number;
  hostNodeId: number;
};

export type ContextHostDroppedEvent = {
  contextId: number;
  hostNodeId: number;
};

export type ContextRootOnlineEvent = {
  rootContextId: number;
};

export class ContextRegistry {
  constructor(private readonly bus: VirtualDomainBus) {}

  announceRootOnline(rootContextId: number): void {
    const event: ContextRootOnlineEvent = { rootContextId };
    this.bus.emit('contextRootOnline', event, { destination: CONTEXT_BUS_RUNTIME });
  }

  admitHost(contextId: number, hostNodeId: number): void {
    const event: ContextHostAdmittedEvent = { contextId, hostNodeId };
    this.bus.emit('contextHostAdmitted', event, { destination: CONTEXT_BUS_RUNTIME });
  }

  dropHost(contextId: number, hostNodeId: number): void {
    const event: ContextHostDroppedEvent = { contextId, hostNodeId };
    this.bus.emit('contextHostDropped', event, { destination: CONTEXT_BUS_RUNTIME });
  }

  onRootOnline(handler: (ev: ContextRootOnlineEvent) => void): () => void {
    return this.bus.onEvent('contextRootOnline', handler);
  }

  onHostAdmitted(handler: (ev: ContextHostAdmittedEvent) => void): () => void {
    return this.bus.onEvent('contextHostAdmitted', handler);
  }

  onHostDropped(handler: (ev: ContextHostDroppedEvent) => void): () => void {
    return this.bus.onEvent('contextHostDropped', handler);
  }
}
