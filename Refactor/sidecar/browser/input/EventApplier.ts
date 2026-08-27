/**
 * Serial EventApplier — routes unified intents (sparse-cdp / live-node only).
 */

import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';
import type { IPointerPeripheral, IKeyboardPeripheral, PointerButton } from './ports';
import type { ClickDeliveryStrategy } from './clickDelivery';
import { SidecarBuffer } from './SidecarBuffer';
import { resolveKeyboardDispatchKey } from './keyboardDispatch';

export type ApplyScrollSetFn = (args: {
  contextId: number;
  nodeId: number | null;
  scrollX: number;
  scrollY: number;
}) => Promise<{ ok: boolean; error?: string }>;

export type ApplyHistoryNavFn = (
  direction: 'back' | 'forward',
) => Promise<{ ok: boolean; error?: string }>;

export type EventApplierOptions = {
  buffer: SidecarBuffer;
  pointer: IPointerPeripheral;
  keyboard: IKeyboardPeripheral;
  clickDelivery: ClickDeliveryStrategy;
  applyScrollSet?: ApplyScrollSetFn;
  applyHistoryNav?: ApplyHistoryNavFn;
  activeViewport: () => { w: number; h: number };
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
        // Sparse catalog rejects continuous move at the peripheral; still validate stamp.
        if (!this.validatePointer(intent)) return;
        this.opts.pointer.moveTo(intent.x, intent.y);
        return;
      case 'down':
      case 'up': {
        if (!this.validatePointer(intent)) return;

        if (intent.nodeId == null) {
          this.reject('missing_node_id', 'validate');
          return;
        }
        const delivery = this.opts.clickDelivery;
        const resolved = await delivery.resolveClickTarget(
          intent.contextId ?? 1,
          intent.nodeId,
          intent.x,
          intent.y,
        );
        if (!resolved.ok || resolved.x == null || resolved.y == null) {
          this.reject(
            resolved.reason ? `resolve_click_failed:${resolved.reason}` : 'resolve_click_failed',
            'virtual_resolve',
          );
          return;
        }
        this.opts.pointer.moveTo(resolved.x, resolved.y);
        this.opts.pointer.button(intent.button ?? 'left', intent.type === 'down');
        return;
      }
      case 'keyDown':
      case 'keyUp': {
        const key = resolveKeyboardDispatchKey(intent.key, intent.code);
        if (!key) {
          this.reject('missing_key', 'validate');
          return;
        }
        this.opts.keyboard.key(key, intent.type === 'keyDown', intent.modifiers);
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
      case 'historyNav': {
        const nav = this.opts.applyHistoryNav;
        if (!nav) {
          this.reject('history_nav_unavailable', 'virtual_apply');
          return;
        }
        const r = await nav(intent.direction);
        if (!r.ok) {
          this.reject(
            r.error ? `apply_history_nav_failed:${r.error}` : 'apply_history_nav_failed',
            'virtual_apply',
          );
        }
        return;
      }
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
