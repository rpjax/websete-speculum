"use strict";
/**
 * frame-protocol.md §8 — mandatory limits, checked **before any allocation** proportional to
 * an attacker/producer-controlled value. Shared by both sides: the client's decode path
 * (`models/decode.ts`), the client's phase-1 table apply (`models/replicatedTableApply.ts`),
 * and the producer's own tick/table growth (`virtual/dom/tableFrameBuilder.ts`).
 *
 * Values are deliberately generous relative to any real page measured so far in this session's
 * real-site probes (frame-protocol.md decision log, 2026-08-13 entries) — these exist to bound a
 * *hostile or corrupted* stream, not to constrain ordinary page structure.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_NODE_DROPS_PER_SWEEP = exports.NODE_DROP_AGE_SEQUENCES = exports.MAX_DIRTY_NODES = exports.MAX_ROWS = exports.MAX_OPS_PER_FRAME = exports.MAX_CHILDREN_PER_OP = exports.MAX_ATTRS = exports.MAX_STR_BYTES = void 0;
/** A corrupted `byteLen` must never trigger a large string allocation (§8). */
exports.MAX_STR_BYTES = 1 << 20; // 1 MiB
/** Per node / per instruction attribute count (§4.2 `NODE_NEW`, §4.4 `ATTR_SET`/`ATTR_DEL`). */
exports.MAX_ATTRS = 1024;
/** Bounds `INSERT`/`REMOVE` batch size (§4.3). */
exports.MAX_CHILDREN_PER_OP = 8192;
/** Bounds decode work for one frame part (§2 `opCount`). */
exports.MAX_OPS_PER_FRAME = 65536;
/**
 * Bounds table growth per session (§8). Client-side defensive cap only — the producer never
 * refuses to track a real, legitimately large page (that would be a K4/1:1-parity defect, not a
 * limit); this guards the client against a hostile/corrupted producer or transport that would
 * otherwise grow its `ReplicatedTable` without bound. ~10x the §1.8 example budget (~20k rows).
 */
exports.MAX_ROWS = 200_000;
/** Bounds the producer's per-tick visited/dirty set (§5.3) — forces a flush rather than unbounded growth under rate degradation. */
exports.MAX_DIRTY_NODES = 20_000;
/**
 * OPEN-2 deferred-age GC (§1.6): a detached row idle this many frame `sequence`s is a sweep
 * candidate. Not a wire constant — tunable per deployment. At a 30-60Hz tick rate this is
 * roughly 0.7-1.3 seconds — tens of ticks of margin over the same-tick/next-tick reuse window
 * `emitNodeDropSweep`'s own ordering fix (2026-08-14, folding this tick's ops into the table
 * before the sweep runs) already closes exactly, so this age margin is purely a cushion for a
 * legitimate multi-tick reuse pattern (e.g. a pooled/recycled node held detached briefly), not
 * load-bearing for same-tick correctness.
 *
 * Retuned down from 120 (2026-08-13's original pick, ~2-4s) after `smokeNodeDropGcBounded`
 * (`scripts/smoke-projection-lab.js`) measured a producer table-size *peak* of 6823 rows against
 * `stress-churn.html`'s sustained ~23 detached-rows/tick churn — not unbounded growth (the
 * steady-state average, ~3350-3597, was already flat/shrinking), but a one-time ramp-up backlog:
 * for the first `NODE_DROP_AGE_SEQUENCES` ticks after churn starts, nothing is old enough to
 * sweep yet, so the backlog grows roughly `churnRate * ageThreshold` before the first sweep ever
 * fires. 40 (~1s) still measured peak=5223, over the gate's 5000-row bound; 20 (~0.3-0.7s) — still
 * an order of magnitude past the same-tick/next-tick margin it actually needs to cover — measured
 * peak=4423, middleAvg=2716, lastAvg=2686 (comfortably under the bound, steady-state flat; see
 * decision log, 2026-08-14).
 */
exports.NODE_DROP_AGE_SEQUENCES = 20;
/** Bounds one tick's GC-sweep cost — same "forced flush over unbounded per-tick work" family as `MAX_DIRTY_NODES`. */
exports.MAX_NODE_DROPS_PER_SWEEP = 500;
//# sourceMappingURL=limits.js.map