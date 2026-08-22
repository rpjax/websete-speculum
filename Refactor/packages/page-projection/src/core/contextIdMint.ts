/** Session-global `contextId` allocator. `1` is reserved for the root. */

export class ContextIdMint {
  private next = 2;

  mint(): number {
    const id = this.next;
    if (id > 0xffffffff) throw new Error('contextId space exhausted');
    this.next = id + 1;
    return id >>> 0;
  }
}
