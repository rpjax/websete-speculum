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
}
