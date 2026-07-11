export type MoveFlush = (x: number, y: number) => void;
export type MoveSchedule = (fn: () => void) => void;

/**
 * Latest-wins coalesce for high-frequency mousemove events.
 * Intermediate positions are dropped; only the last pending move is flushed per tick.
 */
export class MouseMoveCoalescer
{
    private _pending: { x: number; y: number } | null = null;
    private _scheduled = false;

    constructor(
        private readonly _flush: MoveFlush,
        private readonly _schedule: MoveSchedule = fn => setImmediate(fn),
    ) {}

    queue(x: number, y: number): void
    {
        this._pending = { x, y };
        if (this._scheduled) return;
        this._scheduled = true;
        this._schedule(() => this._flushPending());
    }

    private _flushPending(): void
    {
        this._scheduled = false;
        const pending = this._pending;
        this._pending = null;
        if (!pending) return;
        this._flush(pending.x, pending.y);
    }
}
