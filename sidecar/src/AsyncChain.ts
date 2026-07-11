/**
 * Serializes async work through a single promise chain.
 * Used for main-frame HTML injection where parallel fulfillRequest races corrupt state.
 */
export class AsyncChain
{
    private _tail: Promise<void> = Promise.resolve();

    run<T>(fn: () => Promise<T>): Promise<T>
    {
        const run = this._tail.then(fn);
        this._tail = run.then(() => undefined, () => undefined);
        return run;
    }
}
