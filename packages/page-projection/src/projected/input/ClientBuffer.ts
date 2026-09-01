/**
 * Client-side intent buffer (§10.6.1 / D-UI-35 / D-UI-33).
 * move: 50ms coalesce. scrollSet: 100ms coalesce per contextId+nodeId.
 * down/up: immediate (no move flush).
 */

import type { UnifiedIntent, ScrollSetIntent } from '../../core/input/unifiedIntentTypes';

const NEVER_DROP = new Set(['down', 'up']);

export class ClientBuffer {
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMove: UnifiedIntent | null = null;
  private readonly scrollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingScroll = new Map<string, ScrollSetIntent>();

  enqueue(intent: UnifiedIntent, flush: (intent: UnifiedIntent) => void): void {
    if (intent.type === 'move') {
      this.pendingMove = intent;
      if (this.moveTimer) clearTimeout(this.moveTimer);
      this.moveTimer = setTimeout(() => {
        if (this.pendingMove) flush(this.pendingMove);
        this.pendingMove = null;
        this.moveTimer = null;
      }, 50);
      return;
    }
    if (intent.type === 'scrollSet') {
      const key = `${intent.contextId}:${intent.nodeId ?? 'v'}`;
      this.pendingScroll.set(key, intent);
      const prev = this.scrollTimers.get(key);
      if (prev) clearTimeout(prev);
      this.scrollTimers.set(
        key,
        setTimeout(() => {
          const pending = this.pendingScroll.get(key);
          this.pendingScroll.delete(key);
          this.scrollTimers.delete(key);
          if (pending) flush(pending);
        }, 100),
      );
      return;
    }
    if (NEVER_DROP.has(intent.type)) {
      flush(intent);
      return;
    }
    flush(intent);
  }

  dispose(): void {
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = null;
    this.pendingMove = null;
    for (const t of this.scrollTimers.values()) clearTimeout(t);
    this.scrollTimers.clear();
    this.pendingScroll.clear();
  }
}
