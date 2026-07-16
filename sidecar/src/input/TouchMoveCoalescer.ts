import type { TouchPoint } from '../protocol/wire-protocol';

export type TouchMoveFlush = (points: TouchPoint[]) => void;
export type TouchMoveSchedule = (fn: () => void) => void;

/**
 * Latest-wins coalesce for high-frequency touchmove — drops intermediate samples
 * so the CDP queue does not back up behind every pointer sample.
 */
export class TouchMoveCoalescer {
    private _pending: TouchPoint[] | null = null;
    private _scheduled = false;

    constructor(
        private readonly _flush: TouchMoveFlush,
        private readonly _schedule: TouchMoveSchedule = (fn) => setImmediate(fn),
    ) {}

    queue(points: TouchPoint[]): void {
        this._pending = points;
        if (this._scheduled) return;
        this._scheduled = true;
        this._schedule(() => this._flushPending());
    }

    /**
     * Steal pending points and cancel a scheduled flush so the caller can
     * dispatch them synchronously before touch end/cancel/start.
     */
    takePending(): TouchPoint[] | null {
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
