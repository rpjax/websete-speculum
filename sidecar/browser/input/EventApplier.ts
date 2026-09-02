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
  onReject?: (errorCode: string, phase: string, kind: string, viewportW?: number, viewportH?: number) => void;
  onApplied?: (kind: string) => void;
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
        if (!this.validateMove(intent)) return;
        this.opts.pointer.moveTo(intent.x, intent.y);
        this.opts.onApplied?.(intent.type);
        return;
      case 'down':
      case 'up': {
        if (!this.validateClick(intent)) return;

        if (intent.nodeId == null) {
          this.reject(intent.type, 'missing_node_id', 'validate');
          return;
        }
        const delivery = this.opts.clickDelivery;
        const resolved = await delivery.resolveClickTarget(
          intent.contextId ?? 1,
          intent.nodeId,
          intent.localX,
          intent.localY,
        );
        if (!resolved.ok || resolved.x == null || resolved.y == null) {
          this.reject(
            intent.type,
            resolved.reason ? `resolve_click_failed:${resolved.reason}` : 'resolve_click_failed',
            'virtual_resolve',
          );
          return;
        }
        this.opts.pointer.moveTo(resolved.x, resolved.y);
        this.opts.pointer.button(intent.button ?? 'left', intent.type === 'down');
        this.opts.onApplied?.(intent.type);
        return;
      }
      case 'keyDown':
      case 'keyUp': {
        const key = resolveKeyboardDispatchKey(intent.key, intent.code);
        if (!key) {
          this.reject(intent.type, 'missing_key', 'validate');
          return;
        }
        this.opts.keyboard.key(key, intent.type === 'keyDown', intent.modifiers);
        this.opts.onApplied?.(intent.type);
        return;
      }
      case 'scrollSet': {
        const apply = this.opts.applyScrollSet;
        if (!apply) {
          this.reject(intent.type, 'scroll_set_unavailable', 'virtual_apply');
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
            intent.type,
            r.error ? `apply_scroll_failed:${r.error}` : 'apply_scroll_failed',
            'virtual_apply',
          );
          return;
        }
        this.opts.onApplied?.(intent.type);
        return;
      }
      case 'setFiles':
        // D-UI-01b deferred — fine contract stub
        return;
      case 'historyNav': {
        const nav = this.opts.applyHistoryNav;
        if (!nav) {
          this.reject(intent.type, 'history_nav_unavailable', 'virtual_apply');
          return;
        }
        const r = await nav(intent.direction);
        if (!r.ok) {
          this.reject(
            intent.type,
            r.error ? `apply_history_nav_failed:${r.error}` : 'apply_history_nav_failed',
            'virtual_apply',
          );
          return;
        }
        this.opts.onApplied?.(intent.type);
        return;
      }
    }
  }

  private validateViewportStamp(intent: { viewportW: number; viewportH: number; type: string }): boolean {
    const active = this.opts.activeViewport();
    if (intent.viewportW !== active.w || intent.viewportH !== active.h) {
      this.reject(intent.type, 'stale_viewport', 'validate', intent.viewportW, intent.viewportH);
      return false;
    }
    return true;
  }

  private validateMove(intent: { viewportW: number; viewportH: number; x: number; y: number; type: string }): boolean {
    if (!this.validateViewportStamp(intent)) return false;
    if (intent.x < 0 || intent.y < 0 || intent.x >= intent.viewportW || intent.y >= intent.viewportH) {
      this.reject(intent.type, 'invalid_coords', 'validate');
      return false;
    }
    return true;
  }

  private validateClick(intent: {
    viewportW: number;
    viewportH: number;
    localX?: number;
    localY?: number;
    type: string;
  }): boolean {
    if (!this.validateViewportStamp(intent)) return false;
    const hasLocal =
      typeof intent.localX === 'number'
      && typeof intent.localY === 'number'
      && Number.isFinite(intent.localX)
      && Number.isFinite(intent.localY);
    if (!hasLocal) {
      // Lab may omit local (Virtual center). Product Projected always sends local.
      return true;
    }
    if (
      intent.localX! < -1e-6
      || intent.localY! < -1e-6
      || intent.localX! > 1 + 1e-6
      || intent.localY! > 1 + 1e-6
    ) {
      this.reject(intent.type, 'invalid_local', 'validate');
      return false;
    }
    return true;
  }

  private reject(
    kind: string,
    errorCode: string,
    phase: string,
    viewportW?: number,
    viewportH?: number,
  ): void {
    this.opts.onReject?.(errorCode, phase, kind, viewportW, viewportH);
  }
}

export type { PointerButton };
