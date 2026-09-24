/**
 * Phase 10 §4.1 — discard buffered schema patches at/under builtAt, keep the rest in order.
 * Pure: used by ProjectionClient and the byte-identical gate.
 */

export type SchemaBufferedPatch = {
  sequence: number;
  deltas: Uint8Array;
};

/**
 * After a Resync-flagged Patch arrives: drop buffer entries with sequence ≤ builtAt,
 * then return [resyncDeltas, ...kept] in apply order.
 */
export function orderAfterBuiltAt(
  buffer: readonly SchemaBufferedPatch[],
  builtAt: number,
  resyncDeltas: Uint8Array,
): Uint8Array[] {
  const kept = buffer.filter((f) => (f.sequence >>> 0) > (builtAt >>> 0));
  return [resyncDeltas, ...kept.map((f) => f.deltas)];
}

/** Concatenate frames for structural/byte compare. */
export function concatDeltas(frames: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const f of frames) n += f.byteLength;
  const out = new Uint8Array(n);
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.byteLength;
  }
  return out;
}
