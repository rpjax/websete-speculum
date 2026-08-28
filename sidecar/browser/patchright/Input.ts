import type { Page } from 'patchright';
import type { BrowserInput } from '../BrowserSession';
import type { InputBackend } from './input/InputBackend';
import { TouchMoveCoalescer } from './input/TouchMoveCoalescer';

/**
 * Admits BrowserInput synchronously; serializes inject work on a promise chain.
 * Production uses OsInputBackend; unit tests inject PatchrightInputBackend.
 */
export class InputController {
  private _page: Page;
  private _backend: InputBackend;
  private _touchPrimary = false;
  private _movePending: { x: number; y: number } | null = null;
  private _moveScheduled = false;
  /** Bumped when a gesture cancels a stale coalesced move (down/up carry coords). */
  private _moveGeneration = 0;
  private _chain: Promise<void> = Promise.resolve();
  private _chainDepth = 0;
  private readonly _touchMove: TouchMoveCoalescer;

  constructor(page: Page, backend: InputBackend) {
    this._page = page;
    this._backend = backend;
    this._touchMove = new TouchMoveCoalescer((points) => {
      this._enqueueChain(
        () => this._backend.touch('move', points),
        (err) => console.warn('[Input] touchmove:', (err as Error).message),
      );
    });
  }

  rebind(page: Page, backend: InputBackend): void {
    this._page = page;
    this._backend = backend;
    this._chain = Promise.resolve();
    this._chainDepth = 0;
  }

  setTouchPrimary(value: boolean): void {
    this._touchPrimary = value;
  }

  get backend(): InputBackend {
    return this._backend;
  }

  enqueue(input: BrowserInput): void {
    try {
      this._enqueue(input);
    } catch (err) {
      console.warn('[Input] enqueue error:', (err as Error).message);
    }
  }

  /** Unit-test alias. */
  dispatch(input: BrowserInput): void {
    this._enqueue(input);
  }

  private _enqueue(input: BrowserInput): void {
    switch (input.type) {
      case 'mousemove':
        if (this._touchPrimary) return;
        this._queueMouseMove(input.x, input.y);
        return;

      case 'mousedown':
        if (this._touchPrimary) return;
        this._cancelPendingMouseMove();
        this._enqueueChain(
          () => this._backend.down(input.button, input.x, input.y),
          (err) => console.warn('[Input] mousedown:', (err as Error).message),
        );
        return;

      case 'mouseup':
        if (this._touchPrimary) return;
        this._cancelPendingMouseMove();
        this._enqueueChain(
          () => this._backend.up(input.button, input.x, input.y),
          (err) => console.warn('[Input] mouseup:', (err as Error).message),
        );
        return;

      case 'wheel':
        this._cancelPendingMouseMove();
        this._enqueueChain(
          () => this._backend.wheel(input.x, input.y, input.deltaX, input.deltaY),
          (err) => console.warn('[Input] wheel:', (err as Error).message),
        );
        return;

      case 'keydown':
        this._enqueueChain(
          () => this._backend.keyDown(input.key),
          (err) => console.warn('[Input] keydown:', (err as Error).message),
        );
        return;

      case 'keyup':
        if (input.key.length === 1 && input.key.charCodeAt(0) > 127) return;
        this._enqueueChain(
          () => this._backend.keyUp(input.key),
          (err) => console.warn('[Input] keyup:', (err as Error).message),
        );
        return;

      case 'type':
      case 'text':
        this._enqueueChain(
          () => this._backend.typeText(input.text ?? ''),
          (err) => console.warn('[Input] text:', (err as Error).message),
        );
        return;

      case 'touch':
        if (input.phase === 'move') {
          this._touchMove.queue([...input.points]);
          return;
        }
        {
          const pending = this._touchMove.takePending();
          this._enqueueChain(
            async () => {
              if (pending) await this._backend.touch('move', pending);
              await this._backend.touch(input.phase, [...input.points]);
            },
            (err) => console.warn('[Input] touch:', (err as Error).message),
          );
        }
        return;

      case 'goback':
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

  private _cancelPendingMouseMove(): void {
    this._movePending = null;
    this._moveGeneration++;
  }

  private _enqueueChain(work: () => Promise<void>, onError: (err: unknown) => void): void {
    this._chainDepth++;
    this._chain = this._chain
      .then(work)
      .catch(onError)
      .finally(() => {
        this._chainDepth = Math.max(0, this._chainDepth - 1);
      });
  }

  private _queueMouseMove(x: number, y: number): void {
    this._movePending = { x, y };
    if (this._moveScheduled) return;
    this._moveScheduled = true;
    const generation = this._moveGeneration;
    setImmediate(() => {
      this._moveScheduled = false;
      if (generation !== this._moveGeneration) return;
      const p = this._movePending;
      this._movePending = null;
      if (!p || this._touchPrimary) return;
      this._enqueueChain(() => this._backend.move(p.x, p.y), () => {});
    });
  }

  get pendingCount(): number {
    return (this._movePending ? 1 : 0) + this._chainDepth;
  }

  get chainDepth(): number {
    return this._chainDepth;
  }

  async dispose(): Promise<void> {
    this._movePending = null;
    this._moveScheduled = false;
    this._chainDepth = 0;
    this._touchMove.takePending();
    await this._backend.dispose();
  }
}
