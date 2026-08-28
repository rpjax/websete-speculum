/**
 * Lab-only registry of contextId values seen on the wire (OPEN-6 observability).
 */

import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';

export type ContextIndexEntry = {
  contextId: number;
  firstSeen: string;
  lastSeen: string;
  frameCount: number;
};

export class ContextIndex {
  private readonly entries = new Map<number, ContextIndexEntry>();
  private booted = false;

  /** Call once after Virtual producer boot — root context is always active. */
  noteBoot(): void {
    if (this.booted) return;
    this.booted = true;
    this.observeContext(CONTEXT_ID_ROOT);
  }

  observeFrameHeader(hdr: { contextId: number } | null): void {
    if (!hdr || hdr.contextId < 1) return;
    this.observeContext(hdr.contextId);
  }

  observeTelemetry(message: { contextId: number }): void {
    if (message.contextId >= 1) this.observeContext(message.contextId);
  }

  private observeContext(contextId: number): void {
    const now = new Date().toISOString();
    const existing = this.entries.get(contextId);
    if (existing) {
      existing.lastSeen = now;
      existing.frameCount += 1;
      return;
    }
    this.entries.set(contextId, {
      contextId,
      firstSeen: now,
      lastSeen: now,
      frameCount: 1,
    });
  }

  list(): number[] {
    return [...this.entries.keys()].sort((a, b) => a - b);
  }

  meta(contextId: number): ContextIndexEntry | undefined {
    return this.entries.get(contextId);
  }

  toJSON(): { contexts: ContextIndexEntry[] } {
    return {
      contexts: this.list().map((id) => this.entries.get(id)!),
    };
  }
}
