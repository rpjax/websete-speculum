/**
 * Prevents overlapping resize operations (client debounces; guard is a safety net).
 */
export class ResizeGuard
{
    private _active = false;

    tryBegin(): boolean
    {
        if (this._active) return false;
        this._active = true;
        return true;
    }

    get isActive(): boolean
    {
        return this._active;
    }

    end(): void
    {
        this._active = false;
    }
}
