/**
 * Serial EventApplier — routes unified intents (§10.5).
 */

import type { UnifiedIntent, ScrollCensus } from '@speculum/page-projection/core/input/unifiedIntentTypes';
import type { IAbsPointerPeripheral, PointerButton } from './peripherals/AbsPointerPeripheral';
import type { IKeyboardPeripheral } from './peripherals/KeyboardPeripheral';
import { SidecarBuffer } from './SidecarBuffer';

export type ApplyScrollCensusFn = (census: ScrollCensus) => Promise<{ ok: boolean; error?: string }>;

export type ApplyScrollSetFn = (args: {
  contextId: number;
  nodeId: number | null;
  scrollX: number;
  scrollY: number;
}) => Promise<{ ok: boolean; error?: string }>;

export type EventApplierOptions = {
  buffer: SidecarBuffer;
  pointer: IAbsPointerPeripheral;
  keyboard: IKeyboardPeripheral;
  applyScrollCensus?: ApplyScrollCensusFn;
  applyScrollSet?: ApplyScrollSetFn;
  activeViewport: () => { w: number; h: number };
  isPageProjection: () => boolean;
  onReject?: (errorCode: string, phase: string) => void;
};

export class EventApplier {
  private running = false;

  constructor(private readonly opts: EventApplierOptions) {}

  enqueue(intent: UnifiedIntent): void {
    this.opts.buffer.enqueue(intent);
    void this.pump();
  }

  /** Wait until the serial queue is empty (lab helpers / resolveAnd*). */
  async flush(): Promise<void> {
    for (;;) {
      if (!this.running && this.opts.buffer.isEmpty()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const intent = this.opts.buffer.drainOne();
        if (!intent) break;
        await this.applyOne(intent);
      }
    } finally {
      this.running = false;
    }
  }

  private async applyOne(intent: UnifiedIntent): Promise<void> {
    switch (intent.type) {
      case 'move':
        if (!this.validatePointer(intent)) return;
        this.opts.pointer.moveTo(intent.x, intent.y);
        return;
      case 'down':
      case 'up': {
        if (!this.validatePointer(intent)) return;
        if (this.opts.isPageProjection()) {
          if (!intent.census) {
            this.reject('missing_census', 'validate');
            return;
          }
          const phaseA = await this.opts.applyScrollCensus?.(intent.census);
          if (!phaseA?.ok) {
            this.reject(
              phaseA?.error ? `apply_scroll_failed:${phaseA.error}` : 'apply_scroll_failed',
              'virtual_apply',
            );
            return;
          }
        }
        this.opts.pointer.moveTo(intent.x, intent.y);
        this.opts.pointer.button(intent.button ?? 'left', intent.type === 'down');
        return;
      }
      case 'keyDown':
      case 'keyUp': {
        const code = intent.code || intent.key;
        this.opts.keyboard.key(code, intent.type === 'keyDown', intent.modifiers);
        return;
      }
      case 'scrollSet': {
        const apply = this.opts.applyScrollSet;
        if (!apply) {
          this.reject('scroll_set_unavailable', 'virtual_apply');
          return;
        }
        const r = await apply({
          contextId: intent.contextId,
          nodeId: intent.nodeId,
          scrollX: intent.scrollX,
          scrollY: intent.scrollY,
        });
        if (!r.ok) {
          this.reject(
            r.error ? `apply_scroll_failed:${r.error}` : 'apply_scroll_failed',
            'virtual_apply',
          );
        }
        return;
      }
      case 'setFiles':
        // D-UI-01b deferred — fine contract stub
        return;
    }
  }

  private validatePointer(intent: { viewportW: number; viewportH: number; x: number; y: number }): boolean {
    const active = this.opts.activeViewport();
    if (intent.viewportW !== active.w || intent.viewportH !== active.h) {
      this.reject('stale_viewport', 'validate');
      return false;
    }
    if (intent.x < 0 || intent.y < 0 || intent.x >= intent.viewportW || intent.y >= intent.viewportH) {
      this.reject('invalid_coords', 'validate');
      return false;
    }
    return true;
  }

  private reject(errorCode: string, phase: string): void {
    this.opts.onReject?.(errorCode, phase);
  }
}

export type { PointerButton };
