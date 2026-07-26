import type { CDPSession, Page } from 'patchright';
import type { BrowserInput, BrowserTouchPoint } from '../BrowserSession';

function domButton(b: number): 'left' | 'middle' | 'right' {
  if (b === 1) return 'middle';
  if (b === 2) return 'right';
  return 'left';
}

function cdpTouchType(phase: string): 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel' {
  switch (phase) {
    case 'move':
      return 'touchMove';
    case 'end':
      return 'touchEnd';
    case 'cancel':
      return 'touchCancel';
    default:
      return 'touchStart';
  }
}

/** Coalesce high-frequency pointer moves; decisive input is serialized. */
export class InputController {
  private _page: Page;
  private _cdp: CDPSession;
  private _chain: Promise<void> = Promise.resolve();
  private _touchPrimary = false;
  private _movePending: { x: number; y: number } | null = null;
  private _moveScheduled = false;
  /** When true (e.g. during navigate), drop enqueue and pending moves — avoid Frame was detached. */
  private _suspended = false;

  constructor(page: Page, cdp: CDPSession) {
    this._page = page;
    this._cdp = cdp;
  }

  rebind(page: Page, cdp: CDPSession): void {
    this._page = page;
    this._cdp = cdp;
  }

  setTouchPrimary(value: boolean): void {
    this._touchPrimary = value;
  }

  /** Pause/resume the input chain (navigate / recreate). Does not reject in-flight work. */
  setSuspended(value: boolean): void {
    this._suspended = value;
    if (value) {
      this._movePending = null;
    }
  }

  get suspended(): boolean {
    return this._suspended;
  }

  enqueue(input: BrowserInput): void {
    if (this._suspended) return;
    this._chain = this._chain
      .then(() => {
        if (this._suspended) return;
        return this.dispatch(input);
      })
      .catch((err) => {
        console.warn('[Input] error:', (err as Error).message);
      });
  }

  async dispatch(input: BrowserInput): Promise<void> {
    switch (input.type) {
      case 'mousemove':
        if (this._touchPrimary) return;
        this._queueMouseMove(input.x, input.y);
        return;
      case 'mousedown':
        if (this._touchPrimary) return;
        await this._page.mouse.move(input.x, input.y);
        await this._page.mouse.down({ button: domButton(input.button) });
        return;
      case 'mouseup':
        if (this._touchPrimary) return;
        await this._page.mouse.move(input.x, input.y);
        await this._page.mouse.up({ button: domButton(input.button) });
        return;
      case 'wheel': {
        if (!this._touchPrimary) await this._page.mouse.move(input.x, input.y);
        await this._page.mouse.wheel(input.deltaX, input.deltaY);
        return;
      }
      case 'keydown':
        await this._page.keyboard.down(input.key);
        return;
      case 'keyup':
        await this._page.keyboard.up(input.key);
        return;
      case 'type':
        await this._page.keyboard.type(input.text);
        return;
      case 'text':
        await this._page.keyboard.insertText(input.text);
        return;
      case 'touch':
        await this._dispatchTouch(input.phase, [...input.points]);
        return;
      case 'goback':
        await this._page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        return;
      case 'goforward':
        await this._page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        return;
    }
  }

  private _queueMouseMove(x: number, y: number): void {
    if (this._suspended) return;
    this._movePending = { x, y };
    if (this._moveScheduled) return;
    this._moveScheduled = true;
    setImmediate(() => {
      this._moveScheduled = false;
      const p = this._movePending;
      this._movePending = null;
      if (!p || this._touchPrimary || this._suspended) return;
      try {
        void this._page.mouse.move(p.x, p.y).catch(() => {});
      } catch {
        /* frame detached mid-move */
      }
    });
  }

  private async _dispatchTouch(
    phase: string,
    points: BrowserTouchPoint[],
  ): Promise<void> {
    const type = cdpTouchType(phase);
    const touchPoints =
      type === 'touchEnd' || type === 'touchCancel'
        ? []
        : points.map((p) => ({
            x: p.x,
            y: p.y,
            id: p.id,
            radiusX: p.radiusX,
            radiusY: p.radiusY,
            force: p.force,
          }));
    await this._cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }
}
