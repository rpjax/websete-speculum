import type { CDPSession, Page } from 'patchright';
import type { BrowserTouchPoint } from '../../BrowserSession';
import type { InputBackend } from './InputBackend';

function mouseButtonName(b: number): 'left' | 'middle' | 'right' {
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

type Cdp = { send(method: string, params?: object): Promise<unknown> };

/**
 * Patchright/CDP input path — lab/tests and hosts without uinput.
 * One CDP round-trip per gesture (no redundant page.mouse.move before down/up/wheel).
 */
export class PatchrightInputBackend implements InputBackend {
  private _page: Page;
  private _cdp: CDPSession;

  constructor(page: Page, cdp: CDPSession) {
    this._page = page;
    this._cdp = cdp;
  }

  rebind(page: Page, cdp: CDPSession): void {
    this._page = page;
    this._cdp = cdp;
  }

  private get cdp(): Cdp {
    return this._cdp as Cdp;
  }

  async move(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });
  }

  async down(button: number, x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: mouseButtonName(button),
      buttons: buttonMask(button),
      clickCount: 1,
    });
  }

  async up(button: number, x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: mouseButtonName(button),
      buttons: 0,
      clickCount: 1,
    });
  }

  async wheel(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX,
      deltaY,
    });
  }

  async keyDown(key: string): Promise<void> {
    if (key.length === 1 && key.charCodeAt(0) > 127) {
      await this.cdp.send('Input.insertText', { text: key });
      return;
    }
    await this._page.keyboard.down(key);
  }

  async keyUp(key: string): Promise<void> {
    if (key.length === 1 && key.charCodeAt(0) > 127) return;
    await this._page.keyboard.up(key);
  }

  async typeText(text: string): Promise<void> {
    // One CDP call — not character-by-character keyboard.type.
    await this.cdp.send('Input.insertText', { text });
  }

  async touch(phase: string, points: readonly BrowserTouchPoint[]): Promise<void> {
    const type = cdpTouchType(phase);
    if (type === 'touchEnd' || type === 'touchCancel') {
      await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
      if (points.length > 0) {
        await this.cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: points.map(toCdpTouch),
        });
      }
      return;
    }
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(toCdpTouch),
    });
  }

  async dispose(): Promise<void> {
    /* nothing to release */
  }
}

function toCdpTouch(p: BrowserTouchPoint) {
  return {
    x: p.x,
    y: p.y,
    id: p.id,
    radiusX: p.radiusX,
    radiusY: p.radiusY,
    force: p.force,
  };
}

function buttonMask(button: number): number {
  if (button === 1) return 4;
  if (button === 2) return 2;
  return 1;
}
