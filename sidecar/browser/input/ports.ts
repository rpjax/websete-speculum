/**
 * Input adapter ports — sparse-cdp is the sole PageProjection input path
 * (decision-log.md 2026-08-27: OS ABS/S6 removed from codebase).
 *
 * Click addressing is id-based (`live-node-resolve` in clickDelivery.ts / EventApplier),
 * not part of this peripheral bundle.
 */

export type PointerButton = 'left' | 'middle' | 'right';

export interface IPointerPeripheral {
  moveTo(x: number, y: number): void;
  button(btn: PointerButton, down: boolean): void;
  sanitize(): void;
}

export interface IKeyboardPeripheral {
  key(
    code: string,
    down: boolean,
    modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean },
  ): void;
  sanitize(): void;
}

/**
 * How to move the pointer / press keys / re-scale on resize / tear down.
 * Scroll apply and click addressing are session-level, not adapter capabilities.
 */
export interface IInputAdapter {
  readonly kind: string;
  readonly pointer: IPointerPeripheral;
  readonly keyboard: IKeyboardPeripheral;
  setLogicalSize(logicalWidth: number, logicalHeight: number): void;
  dispose(): void;
}
