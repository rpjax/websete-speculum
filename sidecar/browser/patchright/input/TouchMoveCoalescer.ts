import type { BrowserTouchPoint } from '../../BrowserSession';

export type TouchMoveFlush = (points: BrowserTouchPoint[]) => void;
export type TouchMoveSchedule = (fn: () => void) => void;

/**
 * Latest-wins coalesce for high-frequency touchmove — drops intermediate samples
 * so the inject queue does not back up behind every pointer sample.
 */
export class TouchMoveCoalescer {
  private _pending: BrowserTouchPoint[] | null = null;
  private _scheduled = false;
  private _epoch = 0;

  constructor(
    private readonly _flush: TouchMoveFlush,
    private readonly _schedule: TouchMoveSchedule = (fn) => setImmediate(fn),
  ) {}

  queue(points: BrowserTouchPoint[]): void {
    this._pending = points;
    if (this._scheduled) return;
    this._scheduled = true;
    const epoch = this._epoch;
    this._schedule(() => {
      if (epoch !== this._epoch) return;
      this._flushPending();
    });
  }

  /**
   * Steal pending points and cancel a scheduled flush so the caller can
   * dispatch them synchronously before touch end/cancel/start.
   */
  takePending(): BrowserTouchPoint[] | null {
    this._epoch++;
    this._scheduled = false;
    const pending = this._pending;
    this._pending = null;
    return pending;
  }

  private _flushPending(): void {
    this._scheduled = false;
    const pending = this._pending;
    this._pending = null;
    if (!pending) return;
    this._flush(pending);
  }
}
