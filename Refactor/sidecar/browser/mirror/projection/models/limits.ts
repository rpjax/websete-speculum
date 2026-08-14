/**
 * frame-protocol.md §8 — mandatory limits, checked **before any allocation** proportional to
 * an attacker/producer-controlled value. Shared by both sides: the client's decode path
 * (`models/decode.ts`), the client's phase-1 table apply (`models/replicatedTableApply.ts`),
 * and the producer's own tick/table growth (`virtual/frame/tableFrameBuilder.ts`).
 *
 * Values are deliberately generous relative to any real page measured so far in this session's
 * real-site probes (frame-protocol.md decision log, 2026-08-13 entries) — these exist to bound a
 * *hostile or corrupted* stream, not to constrain ordinary page structure.
 */

/** A corrupted `byteLen` must never trigger a large string allocation (§8). */
export const MAX_STR_BYTES = 1 << 20; // 1 MiB

/** Per node / per instruction attribute count (§4.2 `NODE_NEW`, §4.4 `ATTR_SET`/`ATTR_DEL`). */
export const MAX_ATTRS = 1024;

/** Bounds `INSERT`/`REMOVE` batch size (§4.3). */
export const MAX_CHILDREN_PER_OP = 8192;

/** Bounds decode work for one frame part (§2 `opCount`). */
export const MAX_OPS_PER_FRAME = 65536;

/**
 * Bounds table growth per session (§8). Client-side defensive cap only — the producer never
 * refuses to track a real, legitimately large page (that would be a K4/1:1-parity defect, not a
 * limit); this guards the client against a hostile/corrupted producer or transport that would
 * otherwise grow its `ReplicatedTable` without bound. ~10x the §1.8 example budget (~20k rows).
 */
export const MAX_ROWS = 200_000;

/** Bounds the producer's per-tick visited/dirty set (§5.3) — forces a flush rather than unbounded growth under rate degradation. */
export const MAX_DIRTY_NODES = 20_000;

/**
 * OPEN-2 deferred-age GC (§1.6): a detached row idle this many frame `sequence`s is a sweep
 * candidate. Not a wire constant — tunable per deployment. At a 30-60Hz tick rate this is
 * roughly 2-4 seconds, long enough that an ordinary same-tick or next-tick re-insert (§5.6 move
 * detection) never races with the sweep.
 */
export const NODE_DROP_AGE_SEQUENCES = 120;

/** Bounds one tick's GC-sweep cost — same "forced flush over unbounded per-tick work" family as `MAX_DIRTY_NODES`. */
export const MAX_NODE_DROPS_PER_SWEEP = 500;
