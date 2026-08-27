/**
 * Sparse CDP-backed input adapter — sole PageProjection input path
 * (decision-log.md 2026-08-27).
 *
 * Closed catalog: `click` (single moveTo+press+release); keyboard uses `intent.key`
 * (wire canonical): non-ASCII single code unit → `Input.insertText`; ASCII printable
 * (incl. space) + editing/special keys → lazy Playwright `page.keyboard.down/up`
 * (same shape as PatchrightInputBackend).
 * `scrollSet` goes through the session's loopback data plane — adapter-agnostic.
 *
 * Explicitly NOT supported: continuous pointer move / hover / drag. See input.md §7.
 */

import type { IInputAdapter, IKeyboardPeripheral, IPointerPeripheral, PointerButton } from '../ports';

export type CdpSend = (method: string, params?: object) => Promise<unknown>;

export type SparseCdpKeyboardActions = {
  down(key: string): Promise<void>;
  up(key: string): Promise<void>;
};

export type SparseCdpInputOpenOptions = {
  cdp: { send(method: string, params?: object): Promise<unknown> };
  keyboard: SparseCdpKeyboardActions;
  logicalWidth: number;
  logicalHeight: number;
};

const BUTTON_MASK: Record<PointerButton, number> = { left: 1, right: 2, middle: 4 };

export class SparseCdpPointerPeripheral implements IPointerPeripheral {
  private chain: Promise<void> = Promise.resolve();
  private lastX = 0;
  private lastY = 0;
  private awaitingButton = false;
  private rejectedMoves = 0;

  constructor(private readonly send: CdpSend) {}

  moveTo(x: number, y: number): void {
    if (this.awaitingButton) {
      this.rejectedMoves++;
      return;
    }
    this.awaitingButton = true;
    this.lastX = x;
    this.lastY = y;
    this.enqueue(() => this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }));
  }

  button(btn: PointerButton, down: boolean): void {
    this.awaitingButton = false;
    const x = this.lastX;
    const y = this.lastY;
    this.enqueue(() =>
      this.send('Input.dispatchMouseEvent', {
        type: down ? 'mousePressed' : 'mouseReleased',
        x,
        y,
        button: btn,
        buttons: down ? BUTTON_MASK[btn] : 0,
        clickCount: 1,
      }),
    );
  }

  sanitize(): void {
    this.awaitingButton = false;
    const x = this.lastX;
    const y = this.lastY;
    this.enqueue(() =>
      this.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      }),
    );
  }

  get rejectedContinuousMoveCount(): number {
    return this.rejectedMoves;
  }

  flush(): Promise<void> {
    return this.chain;
  }

  private enqueue(fn: () => Promise<unknown>): void {
    this.chain = this.chain.then(fn).then(
      () => undefined,
      () => undefined,
    );
  }
}

/**
 * Keyboard: non-ASCII insertText (down edge); ASCII + named keys via Playwright keyboard.
 */
export class SparseCdpKeyboardPeripheral implements IKeyboardPeripheral {
  private chain: Promise<void> = Promise.resolve();
  private rejectedKeys = 0;

  constructor(
    private readonly send: CdpSend,
    private readonly keyboard: SparseCdpKeyboardActions,
  ) {}

  key(
    key: string,
    down: boolean,
    _modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean },
  ): void {
    if (!key) {
      this.rejectedKeys++;
      return;
    }
    if (key.length === 1 && key.charCodeAt(0) > 127) {
      if (down) this.enqueue(() => this.send('Input.insertText', { text: key }));
      return;
    }
    this.enqueue(() => (down ? this.keyboard.down(key) : this.keyboard.up(key)));
  }

  sanitize(): void {
    /* edge-triggered; nothing to release */
  }

  get rejectedKeyCount(): number {
    return this.rejectedKeys;
  }

  flush(): Promise<void> {
    return this.chain;
  }

  private enqueue(fn: () => Promise<unknown>): void {
    this.chain = this.chain.then(fn).then(
      () => undefined,
      () => undefined,
    );
  }
}

export function openSparseCdpInputAdapter(opts: SparseCdpInputOpenOptions): IInputAdapter {
  const send: CdpSend = opts.cdp.send.bind(opts.cdp);
  const pointer = new SparseCdpPointerPeripheral(send);
  const keyboard = new SparseCdpKeyboardPeripheral(send, opts.keyboard);
  return {
    kind: 'sparse-cdp',
    pointer,
    keyboard,
    setLogicalSize(): void {},
    dispose(): void {},
  };
}
