/**
 * Lab DOM projection client — decode → apply straight into a live document → surface.
 * No establish / armed-vs-building split (frame-protocol.md §4.7): the first frame this
 * client ever applies is an ordinary frame carrying the whole initial document as
 * `NODE_NEW`/`INSERT` ops, applied the same way as every later frame (P8).
 *
 * Stage 4 (frame-protocol-production-completeness), §5.8 "Client side": on any desync, requests
 * a resync over the existing control channel and builds the response into the surface's standby
 * buffer (`surface.ts`) via a second, fully independent `DomFrameApplier` — its own table,
 * its own registry — so a resync build can never touch the still-visible, still-correct-enough
 * live surface until its own closing `CHECK` verifies OK. See `beginResyncTarget`/
 * `commitResyncSwap`/`failResyncAttempt` below for the state machine.
 */

import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
  type AssembledFrame,
} from '../models/decode';
import { DomFrameApplier } from './applyDom';
import { PageProjectionRegistry } from './registry';
import { createSurfaceHost, type SurfaceHost } from './surface';
import { captureParityFingerprint } from './parityFingerprint';
import { digestReplicatedTable } from '../models/tableDigest';
import { DOCUMENT_ID } from '../models/frame';
import { OpCode } from '../models/opcodes';
import { desyncPhase, type TelemetryPhase } from '../models/telemetry';

export type LabProjectionClientOptions = {
  surfaceHost: HTMLElement;
  width?: number;
  height?: number;
  onTelemetry?: (msg: Record<string, unknown>) => void;
  /** Fires once, after the first frame (sequence 1) applies successfully. */
  onArmed?: () => void;
  onDesync?: (reason: string) => void;
  /**
   * Stage 4 — fired once per resync attempt actually sent (after backoff), carrying this
   * client's own last-known-good `generation`/`sequence` (diagnostic only — see `resync.ts`'s
   * own doc comment on why the producer never needs to trust these) and the reason of whichever
   * desync triggered it. The caller is expected to relay this over the session control WS
   * (`client.requestResync` on the lab control WS) — this class has no transport of its own.
   */
  onRequestResync?: (info: { generation: number; sequence: number; reason: string }) => void;
};

/** One `DomFrameApplier` + its own registry — either the live surface or an in-flight standby build. */
type ApplyTarget = {
  applier: DomFrameApplier;
  registry: PageProjectionRegistry;
};

/** In-flight resync build (`ApplyTarget` plus which attempt number produced it). */
type ResyncBuild = ApplyTarget & { attempt: number };

const MAX_RESYNC_ATTEMPTS = 3;
const RESYNC_BACKOFF_MS = 300;
/** How long to wait for a resync-flagged frame to arrive after requesting one before retrying. */
const RESYNC_RESPONSE_TIMEOUT_MS = 5_000;

export class LabProjectionClient {
  private persistentStrings = new PersistentStringTable();
  private assembler = new FramePartAssembler();
  private readonly surface: SurfaceHost;
  private readonly onTelemetry?: (msg: Record<string, unknown>) => void;
  private readonly onArmedCb?: () => void;
  private readonly onDesyncCb?: (reason: string) => void;
  private readonly onRequestResyncCb?: (info: { generation: number; sequence: number; reason: string }) => void;

  /** The currently-live target — reassigned wholesale on a successful resync swap. */
  private live: ApplyTarget;
  /** Set only while a resync response is being built into the standby surface; `null` otherwise. */
  private resync: ResyncBuild | null = null;

  private resyncAttempts = 0;
  private resyncExhausted = false;
  private resyncBackoffTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  private lastSequence = 0;
  private generation = 1;
  private armed = false;
  /**
   * Stage 4 — distinguishes cold start from mid-session recovery. `resync: true` is not unique to
   * `emitResyncFrame`: bootstrap's own cold-start frame (`rebuildAndResync`) sets it too, for the
   * same reason (§2 — "no prior state to check against a wholesale replace", the *first* frame
   * has no prior state either). The double buffer exists to protect an already-good live surface
   * while a replacement is built off to the side; at cold start there is no live surface yet to
   * protect, so a resync-flagged frame is only routed into a standby build once this has been
   * `true` at least once — i.e. once the ordinary live target has actually shown something.
   */
  private everArmed = false;
  /** Sticky until resetSurface — inject proofs must not lose the desync to a later resync. */
  private lastDesyncReason: string | null = null;

  constructor(opts: LabProjectionClientOptions) {
    this.surface = createSurfaceHost(opts.surfaceHost, {
      width: opts.width ?? 1280,
      height: opts.height ?? 720,
    });
    this.onTelemetry = opts.onTelemetry;
    this.onArmedCb = opts.onArmed;
    this.onDesyncCb = opts.onDesync;
    this.onRequestResyncCb = opts.onRequestResync;

    const registry = new PageProjectionRegistry();
    registry.register(DOCUMENT_ID, this.surface.document);
    this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /**
   * Last sequence accepted into the apply queue (may still be one `requestAnimationFrame` away
   * from actually hitting the DOM) — lab test introspection only (Stage 2 gate: a test needs
   * this to construct a corrupted frame's `sequence` field as exactly `lastAcceptedSequence + 1`).
   */
  get lastAcceptedSequence(): number {
    return this.lastSequence;
  }

  /** Surface's currently-*active* document — changes identity across a resync swap (Stage 4). */
  get document(): Document {
    return this.surface.document;
  }

  /** Probe: replicated table at the last applied sequence (same turn as the caller). */
  snapshotTable(): {
    sequence: number;
    generation: number;
    table: ReturnType<typeof digestReplicatedTable>;
  } {
    return {
      sequence: this.lastSequence,
      generation: this.generation,
      table: digestReplicatedTable(this.live.applier.replicatedTable),
    };
  }

  /** Drain queued frames before a lab snapshot / inject. */
  flushNow(): void {
    this.live.applier.flush();
    this.resync?.applier.flush();
  }

  get desynced(): boolean {
    return this.lastDesyncReason !== null;
  }

  get applyError(): string | null {
    return this.lastDesyncReason;
  }

  /** Standby resync build in flight — lab inject must wait so the hostile frame hits live. */
  get resyncInFlight(): boolean {
    return this.resync !== null;
  }

  /**
   * Lab inject (SEAL-CSSOM-P0-EOF): extra live rule with no table row.
   * Honest producer never emits this; CHECK after this must desync at end-of-frame verify.
   * Only constructed/`adoptedStyleSheets` — author `document.styleSheets` is invisible to EOF verify.
   */
  tamperGhostCssRule(): { ok: boolean; reason?: string } {
    const adopted = this.document.adoptedStyleSheets;
    const sheet = adopted.length > 0 ? adopted[adopted.length - 1] : undefined;
    if (!sheet) return { ok: false, reason: 'tamper missed constructed sheet' };
    try {
      sheet.insertRule('.lab-ghost-eof{color:red}', 0);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Lab UI: empty the projected iframe and reset apply state. Does not touch Virtual. */
  resetSurface(): void {
    this.abandonResyncAttempt();
    this.resyncAttempts = 0;
    this.resyncExhausted = false;
    this.persistentStrings = new PersistentStringTable();
    this.assembler = new FramePartAssembler();
    this.lastSequence = 0;
    this.generation = 1;
    this.armed = false;
    this.everArmed = false;
    this.lastDesyncReason = null;
    this.surface.reset();
    const registry = new PageProjectionRegistry();
    registry.register(DOCUMENT_ID, this.surface.document);
    this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
  }

  ingest(bytes: Uint8Array): void {
    const decoded = decodeFramePart(bytes, this.persistentStrings);
    if (!decoded.ok) {
      this.desync(decoded.reason, { message: decoded.message });
      return;
    }
    const assembled = this.assembler.ingest(decoded.part);
    if (assembled === 'missing_part') {
      this.desync('missing_part');
      return;
    }
    if (assembled === null) return;
    this.applyAssembled(assembled);
  }

  private applyAssembled(frame: AssembledFrame): void {
    if (frame.generation !== this.generation) {
      // §7 ordering rule 1 ("EPOCH_RESET first, if present") — a frame announcing a new
      // generation is only valid when its own leading op says so explicitly (Stage 3); anything
      // else claiming a different generation without that announcement is a real mismatch.
      const firstOp = frame.ops[0];
      const isEpochReset = firstOp !== undefined && firstOp.op === OpCode.EpochReset;
      if (!isEpochReset || firstOp.generation !== frame.generation) {
        this.desync('generation_mismatch', { message: `got ${frame.generation} have ${this.generation}` });
        return;
      }
      // §1.2/§4.1: "this generation is over, nothing carries forward" — a fresh generation
      // restarts sequence numbering too (bootstrap.ts always sends its first frame at
      // `sequence: 1` for whichever generation it is), so accepting the transition here means
      // resetting `lastSequence` to just before it, not carrying the old generation's count.
      this.generation = frame.generation;
      this.lastSequence = frame.sequence - 1;
      // A new generation makes whatever the old generation was recovering from moot — abandon
      // any in-flight resync build/backoff instead of racing it against the fresh navigation.
      this.abandonResyncAttempt();
      this.resyncAttempts = 0;
      this.resyncExhausted = false;
    }

    if (frame.resync) {
      // Stage 4, §5.8 step 5: "the frame is sent with sequence incremented normally ... not a
      // side channel" — from the *producer's* numbering, not necessarily contiguous with whatever
      // this client last applied (it kept ticking while this client sat desynced). Adopt this
      // frame's own sequence context exactly like the generation-change branch above does, rather
      // than special-casing the ordinary gap check below.
      this.lastSequence = frame.sequence - 1;
      if (this.everArmed) this.beginResyncTarget();
    }

    if (frame.sequence !== this.lastSequence + 1) {
      this.desync('sequence_gap', { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
      return;
    }
    this.lastSequence = frame.sequence;
    const target = this.resync ?? this.live;
    target.applier.enqueue(frame);
  }

  /**
   * Stage 4 — one independent `DomFrameApplier` per target (live or standby-under-resync), never
   * a single mutable target: each owns its own `ReplicatedTable` (constructed internally by
   * `DomFrameApplier`) and registry, so a resync build's phase 1/2 can never observe or corrupt
   * the live surface's own table, and vice versa. `swapped` starts `false` for a resync target and
   * flips exactly once, on its first successful apply (always the resync frame itself, since
   * that's what creates this target) — every callback after that behaves like an ordinary live
   * frame, whether this *is* the live target from construction or was just promoted to it.
   */
  private createApplier(doc: Document, registry: PageProjectionRegistry, initiallyLive: boolean): DomFrameApplier {
    const state = { swapped: initiallyLive };
    const applier = new DomFrameApplier(doc, registry, {
      onDesync: (info) => {
        if (state.swapped) {
          this.reportApplyResult({ ok: false, sequence: this.lastSequence, opCount: 0, applyMs: 0, reason: info.reason });
          this.desync(info.reason, {
            op: info.op,
            id: info.id,
            expected: info.expected,
            actual: info.actual,
            message: info.message,
            phase: info.phase,
          });
        } else {
          this.failResyncAttempt(info.reason);
        }
      },
      onApplied: (frame, applyMs) => {
        if (state.swapped) {
          this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
          this.emitFingerprint(frame.sequence);
          if (!this.armed) {
            this.armed = true;
            this.everArmed = true;
            this.onArmedCb?.();
          }
        } else {
          state.swapped = true;
          this.commitResyncSwap(frame, applyMs);
        }
      },
      onOverrun: (durationMs, lastSequence) => {
        this.onTelemetry?.({
          v: 1,
          kind: 'applyOverrun',
          t: performance.now(),
          generation: this.generation,
          sequence: lastSequence,
          durationMs,
          budgetMs: 4,
        });
      },
    });
    return applier;
  }

  /** Begins (or restarts) a standby build the moment a `resync`-flagged frame is first seen. */
  private beginResyncTarget(): void {
    if (this.resyncTimeoutTimer !== null) {
      clearTimeout(this.resyncTimeoutTimer);
      this.resyncTimeoutTimer = null;
    }
    if (this.resync !== null) {
      // A stale in-flight build from a race (e.g. two requests both got served) — the newer
      // resync frame is a strictly more current re-description of truth; no reason to keep it.
      this.surface.discardBuild();
      this.resync = null;
    }
    const doc = this.surface.beginResyncBuild();
    const registry = new PageProjectionRegistry();
    registry.register(DOCUMENT_ID, doc);
    const applier = this.createApplier(doc, registry, false);
    this.resync = { applier, registry, attempt: this.resyncAttempts };
  }

  /** Stage 4, §5.8: closing `CHECK` verified OK (this is what `DomFrameApplier`'s `onApplied` already gates on) — swap. */
  private commitResyncSwap(frame: AssembledFrame, applyMs: number): void {
    const built = this.resync;
    if (built === null) return; // defensive — should not happen, onApplied only fires for a live enqueue
    this.surface.commitSwap();
    this.live = { applier: built.applier, registry: built.registry };
    this.resync = null;
    this.resyncAttempts = 0;
    this.resyncExhausted = false;
    this.onTelemetry?.({
      v: 1,
      kind: 'resyncCompleted',
      t: performance.now(),
      generation: this.generation,
      sequence: frame.sequence,
      attempt: built.attempt,
    });
    this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
    this.emitFingerprint(frame.sequence);
    if (!this.armed) {
      this.armed = true;
      this.everArmed = true;
      this.onArmedCb?.();
    }
  }

  /**
   * A resync frame's own phase 1/2 failed (frame-protocol.md: "a resync frame whose closing CHECK
   * fails is a defect, not a recoverable state") or the producer never answered in time. Neither
   * touches the live surface — `this.live` is untouched, still showing whatever it showed before
   * this attempt, stale but not broken further. Retries (bounded) rather than giving up on one
   * failure, purely as defensive engineering against a transient blip, not because failure here
   * is expected to be routine.
   */
  private failResyncAttempt(reason: string): void {
    const attempt = this.resync?.attempt ?? this.resyncAttempts;
    if (this.resync !== null) {
      this.surface.discardBuild();
      this.resync = null;
    }
    this.onTelemetry?.({
      v: 1,
      kind: 'resyncFailed',
      t: performance.now(),
      generation: this.generation,
      sequence: this.lastSequence,
      attempt,
      reason,
      exhausted: false,
    });
    this.scheduleResyncAttempt(reason);
  }

  private abandonResyncAttempt(): void {
    if (this.resyncBackoffTimer !== null) {
      clearTimeout(this.resyncBackoffTimer);
      this.resyncBackoffTimer = null;
    }
    if (this.resyncTimeoutTimer !== null) {
      clearTimeout(this.resyncTimeoutTimer);
      this.resyncTimeoutTimer = null;
    }
    if (this.resync !== null) {
      this.surface.discardBuild();
      this.resync = null;
    }
  }

  /**
   * Bounded retry with backoff (frame-protocol.md §5.8: "ordinary defensive engineering against a
   * retry storm ... exceeding the bound MUST surface as a hard, catalogued session failure ...
   * never a silent, indefinite retry loop"). One attempt in flight at a time — a concurrent
   * backoff timer or an already-answered-and-building resync makes this a no-op.
   */
  private scheduleResyncAttempt(reason: string): void {
    if (this.resyncExhausted) return;
    if (this.resyncBackoffTimer !== null || this.resyncTimeoutTimer !== null || this.resync !== null) return;
    const attempt = this.resyncAttempts + 1;
    if (attempt > MAX_RESYNC_ATTEMPTS) {
      this.resyncExhausted = true;
      this.onTelemetry?.({
        v: 1,
        kind: 'resyncFailed',
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        attempt: this.resyncAttempts,
        reason,
        exhausted: true,
      });
      return;
    }
    const delay = attempt === 1 ? 0 : RESYNC_BACKOFF_MS * (attempt - 1);
    this.resyncBackoffTimer = setTimeout(() => {
      this.resyncBackoffTimer = null;
      this.resyncAttempts = attempt;
      this.onTelemetry?.({
        v: 1,
        kind: 'resyncRequested',
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        reason,
        attempt,
      });
      this.onRequestResyncCb?.({ generation: this.generation, sequence: this.lastSequence, reason });
      this.resyncTimeoutTimer = setTimeout(() => {
        this.resyncTimeoutTimer = null;
        this.failResyncAttempt('resync_timeout');
      }, RESYNC_RESPONSE_TIMEOUT_MS);
    }, delay);
  }

  private emitFingerprint(sequence: number): void {
    const fp = captureParityFingerprint(this.surface.document, this.live.registry);
    this.onTelemetry?.({
      v: 1,
      kind: 'parityFingerprint',
      t: performance.now(),
      generation: this.generation,
      sequence,
      ...fp,
    });
  }

  private reportApplyResult(info: {
    ok: boolean;
    sequence: number;
    opCount: number;
    applyMs: number;
    reason?: string;
  }): void {
    this.onTelemetry?.({
      v: 1,
      kind: 'applyResult',
      t: performance.now(),
      generation: this.generation,
      sequence: info.sequence,
      ok: info.ok,
      opCount: info.opCount,
      applyMs: info.applyMs,
      tableSize: this.live.applier.replicatedTable.size,
      reason: info.reason,
    });
  }

  private desync(
    reason: string,
    extra?: {
      expectedSequence?: number;
      gotSequence?: number;
      op?: string;
      id?: number;
      message?: string;
      expected?: bigint;
      actual?: bigint;
      /** Overrides the `errorCode → phase` default — see `DomDesyncInfo.phase` (applyDom.ts). */
      phase?: TelemetryPhase;
    },
  ): void {
    if (this.lastDesyncReason === null) {
      this.lastDesyncReason = extra?.op ? `${reason}:${extra.op}` : reason;
    }
    this.armed = false;
    this.assembler.reset();
    this.live.applier.reset();
    this.onTelemetry?.({
      v: 1,
      kind: 'desynced',
      t: performance.now(),
      generation: this.generation,
      sequence: extra?.gotSequence ?? this.lastSequence,
      errorCode: reason,
      phase: extra?.phase ?? desyncPhase(reason),
      expectedSequence: extra?.expectedSequence,
      op: extra?.op,
      id: extra?.id,
      message: extra?.message,
      // §4.1 CHECK / §2 preTableHash mismatch (`reason: 'precondition'`) — u64 rides as a decimal
      // string, `bigint` is not JSON-serializable.
      expected: extra?.expected?.toString(),
      actual: extra?.actual?.toString(),
    });
    this.onDesyncCb?.(reason);
    // Stage 4 — every desync condition requests a resync (frame-protocol.md §5.8: "id
    // unresolved, sequence gap, generation mismatch, missing part, decode error, CHECK mismatch"
    // all share the one mechanism), bounded/backed-off, never silent indefinite retrying.
    // Deliberately does NOT abandon an already-in-flight attempt first: while waiting for a
    // response, every further ordinary frame that arrives still fails the same sequence-gap
    // check (`lastSequence` hasn't moved yet) and would otherwise re-trigger this path on every
    // single one of them — `scheduleResyncAttempt`'s own single-attempt-in-flight guard is what
    // must absorb that, not a reset-and-restart here (which would burn the whole retry budget in
    // milliseconds instead of waiting out `RESYNC_RESPONSE_TIMEOUT_MS` between attempts).
    this.scheduleResyncAttempt(reason);
  }
}
