/**
 * Monotonic navigation generation — stale async navigations are ignored after completion.
 */
export class NavigationGeneration
{
    private _generation = 0;

    begin(): number
    {
        return ++this._generation;
    }

    isCurrent(generation: number): boolean
    {
        return generation === this._generation;
    }
}
