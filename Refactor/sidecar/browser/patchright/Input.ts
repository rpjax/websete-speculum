import type { CDPSession, Page } from 'patchright';
import type { BrowserInput, BrowserTouchPoint } from '../BrowserSession';

function mouseButtonName(b: number): 'left' | 'middle' | 'right' | 'none' {
  if (b === 1) return 'middle';
  if (b === 2) return 'right';
  if (b === 0) return 'left';
  return 'none';
}

function mouseButtonMask(b: number): number {
  if (b === 0) return 1;
  if (b === 1) return 4;
  if (b === 2) return 2;
  return 0;
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

/** Text for Input.dispatchKeyEvent so Enter/Tab/printable trigger default actions. */
function keyText(key: string): string | undefined {
  if (key === 'Enter') return '\r';
  if (key === 'Tab') return '\t';
  if (key === ' ') return ' ';
  if (key.length === 1) return key;
  return undefined;
}

/**
 * Pointer/key/touch → Chrome Input.* domain, fire-and-forget.
 * Does not await CDP; does not serialize behind navigate/resize.
 * History nav is also non-blocking (void) so it cannot stall the input path.
 */
export class InputController {
  private _page: Page;
  private _cdp: CDPSession;
  private _touchPrimary = false;
  private _buttons = 0;
  private _movePending: { x: number; y: number } | null = null;
  private _moveScheduled = false;
  private _inFlight = 0;

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

  /** Admission is synchronous — CDP work is scheduled without awaiting. */
  enqueue(input: BrowserInput): void {
    try {
      this.dispatch(input);
    } catch (err) {
      console.warn('[Input] error:', (err as Error).message);
    }
  }

  dispatch(input: BrowserInput): void {
    switch (input.type) {
      case 'mousemove':
        if (this._touchPrimary) return;
        this._queueMouseMove(input.x, input.y);
        return;
      case 'mousedown':
        if (this._touchPrimary) return;
        this._buttons |= mouseButtonMask(input.button);
        this._sendMouse('mousePressed', input.x, input.y, input.button, 1);
        return;
      case 'mouseup':
        if (this._touchPrimary) return;
        this._buttons &= ~mouseButtonMask(input.button);
        this._sendMouse('mouseReleased', input.x, input.y, input.button, 1);
        return;
      case 'wheel':
        if (this._touchPrimary) {
          this._sendWheel(input.x, input.y, input.deltaX, input.deltaY);
          return;
        }
        this._sendMouse('mouseMoved', input.x, input.y, -1, 0);
        this._sendWheel(input.x, input.y, input.deltaX, input.deltaY);
        return;
      case 'keydown':
        this._sendKey('keyDown', input.key);
        return;
      case 'keyup':
        this._sendKey('keyUp', input.key);
        return;
      case 'type':
      case 'text':
        this._ff('Input.insertText', { text: input.text });
        return;
      case 'touch':
        this._dispatchTouch(input.phase, [...input.points]);
        return;
      case 'goback':
        // History is not pointer/key — never await on the input path.
        void this._page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
          console.warn('[Input] goback:', (err as Error).message);
        });
        return;
      case 'goforward':
        void this._page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
          console.warn('[Input] goforward:', (err as Error).message);
        });
        return;
    }
  }

  private _queueMouseMove(x: number, y: number): void {
    this._movePending = { x, y };
    if (this._moveScheduled) return;
    this._moveScheduled = true;
    setImmediate(() => {
      this._moveScheduled = false;
      const p = this._movePending;
      this._movePending = null;
      if (!p || this._touchPrimary) return;
      this._sendMouse('mouseMoved', p.x, p.y, -1, 0);
    });
  }

  private _sendMouse(
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved',
    x: number,
    y: number,
    button: number,
    clickCount: number,
  ): void {
    this._ff('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : mouseButtonName(button),
      buttons: this._buttons,
      clickCount,
    });
  }

  private _sendWheel(x: number, y: number, deltaX: number, deltaY: number): void {
    this._ff('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX,
      deltaY,
      button: 'none',
      buttons: this._buttons,
    });
  }

  private _sendKey(type: 'keyDown' | 'keyUp', key: string): void {
    const text = type === 'keyDown' ? keyText(key) : undefined;
    const params: Record<string, unknown> = {
      type: text && type === 'keyDown' ? 'keyDown' : type === 'keyDown' ? 'rawKeyDown' : 'keyUp',
      key,
    };
    if (text) {
      params.text = text;
      params.unmodifiedText = text;
    }
    this._ff('Input.dispatchKeyEvent', params);
  }

  private _dispatchTouch(phase: string, points: BrowserTouchPoint[]): void {
    const type = cdpTouchType(phase);
    if (type === 'touchEnd' || type === 'touchCancel') {
      this._ff('Input.dispatchTouchEvent', { type, touchPoints: [] });
      if (points.length > 0) {
        this._ff('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: points.map((p) => ({
            x: p.x,
            y: p.y,
            id: p.id,
            radiusX: p.radiusX,
            radiusY: p.radiusY,
            force: p.force,
          })),
        });
      }
      return;
    }

    this._ff('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({
        x: p.x,
        y: p.y,
        id: p.id,
        radiusX: p.radiusX,
        radiusY: p.radiusY,
        force: p.force,
      })),
    });
  }

  private _ff(method: string, params: Record<string, unknown>): void {
    this._inFlight++;
    void (this._cdp as { send(method: string, params?: object): Promise<unknown> })
      .send(method, params)
      .catch((err: unknown) => {
        console.warn(`[Input] ${method}:`, (err as Error).message);
      })
      .finally(() => {
        this._inFlight = Math.max(0, this._inFlight - 1);
      });
  }

  get pendingCount(): number {
    return this._inFlight + (this._movePending ? 1 : 0);
  }
}
