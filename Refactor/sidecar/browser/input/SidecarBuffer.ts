/**
 * Ordered sidecar input buffer (§10.6 / D-UI-17).
 */

import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';

const NEVER_DROP: ReadonlySet<string> = new Set(['down', 'up']);

export class SidecarBuffer {
  private readonly queue: UnifiedIntent[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 512) {
    this.maxSize = maxSize;
  }

  enqueue(intent: UnifiedIntent): void {
    if (this.queue.length >= this.maxSize && !NEVER_DROP.has(intent.type)) {
      const dropIdx = this.queue.findIndex((i) => !NEVER_DROP.has(i.type));
      if (dropIdx >= 0) this.queue.splice(dropIdx, 1);
      else return;
    }
    this.queue.push(intent);
  }

  drainOne(): UnifiedIntent | undefined {
    return this.queue.shift();
  }

  get pending(): number {
    return this.queue.length;
  }
}
