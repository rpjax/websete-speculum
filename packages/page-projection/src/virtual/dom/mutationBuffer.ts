/**
 * Raw MutationRecord buffer — frame-protocol.md §5.2. No processing in the observer
 * callback; the buffer only accumulates until the next tick drains it. Replaces the old
 * dirty-set accumulator (DomMutationAccumulator) — the new algorithm re-derives structure
 * from MutationRecords + the live DOM at drain time (§5.5) instead of maintaining marks.
 */
export class MutationBuffer {
  private records: MutationRecord[] = [];

  push(batch: MutationRecord[]): void {
    for (let i = 0; i < batch.length; i++) this.records.push(batch[i]!);
  }

  hasWork(): boolean {
    return this.records.length > 0;
  }

  /** Freezes and clears the buffer; returns what was pending. */
  drain(): MutationRecord[] {
    if (this.records.length === 0) return this.records;
    const out = this.records;
    this.records = [];
    return out;
  }

  /** Pushes records back to the front (build failed / needs retry next tick). */
  reclaim(records: MutationRecord[]): void {
    if (records.length === 0) return;
    this.records = records.concat(this.records);
  }
}
