/**
 * Client-only: user is editing this control (input.md §7.2).
 * Phase 1 still applies PROP_SET. Phase 2 consults this before touching the live field.
 */

import type { PropSetOp } from './frame';

export class FormPropDirty {
  private readonly dirty = new Set<number>();
  private readonly stash = new Map<number, PropSetOp>();

  mark(id: number): void {
    this.dirty.add(id);
  }

  clear(id: number): void {
    this.dirty.delete(id);
  }

  isDirty(id: number): boolean {
    return this.dirty.has(id);
  }

  hold(op: PropSetOp): void {
    this.stash.set(op.node, op);
  }

  take(id: number): PropSetOp | undefined {
    const op = this.stash.get(id);
    this.stash.delete(id);
    return op;
  }

  reset(): void {
    this.dirty.clear();
    this.stash.clear();
  }
}
