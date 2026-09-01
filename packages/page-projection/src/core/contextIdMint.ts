/** Session-global `contextId` allocator. `1` is reserved for the root. */

import { CONTEXT_ID_MAX_DOCUMENT } from './contextBusConstants';

export class ContextIdMint {
  private next = 2;

  mint(): number {
    const id = this.next;
    if (id > CONTEXT_ID_MAX_DOCUMENT) throw new Error('contextId space exhausted');
    this.next = id + 1;
    return id >>> 0;
  }

  /** True for root (1) or any id already returned by {@link mint}. */
  hasMinted(id: number): boolean {
    if (id === 1) return true;
    return Number.isInteger(id) && id >= 2 && id < this.next;
  }
}
