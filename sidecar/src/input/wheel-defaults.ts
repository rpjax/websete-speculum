/** Wheel deltas: missing/NaN deltaX defaults to 0 (clients often omit horizontal scroll). */
export function normalizeWheelDeltas(msg: { deltaX?: number; deltaY?: number }): {
    deltaX: number;
    deltaY: number;
} {
    return {
        deltaX: Number.isFinite(msg.deltaX) ? (msg.deltaX as number) : 0,
        deltaY: Number.isFinite(msg.deltaY) ? (msg.deltaY as number) : 0,
    };
}
