import { IdentitySpace } from './identity';
import { createDirtyState, type DirtyState } from './observe';
import { FrameAccumulator, type FrameOp, type FrameTreeQuery } from './frame';
import { FrameClock, type FrameClockScheduler } from './clock';
import { encodeFrame, type DocumentStateOp, type EncodedFrameMeta, type WireOp } from './encode';
import { CssomCoalescer } from './cssom';
import { createEstablishHandoff, openEstablishEpoch, accumulateDuringEstablish, markSnapshotTaken, drainForEmitAfterEnd } from './establish';
import type { PageToNodeChannel } from './channel';
import { pushFrameParts } from './channel';
import { NodeMirror } from './node/mirror';
import { UrlRewriter } from './node/rewrite';

/**
 * §9 — orchestration only. Every decision (identity, F, dirty accumulation,
 * flush ordering, rate policy, encoding, mirroring, rewriting) is owned by
 * the module named in the call; this class only wires them together and
 * exposes the session-facing surface. Event shapes echo the pre-redesign
 * `PageProjection` so the caller (`PatchrightBrowserSession`, wired later)
 * has a familiar seam to integrate against.
 */

export type PageProjectionEngineEvents = {
  onFrame(parts: Uint8Array[], meta: EncodedFrameMeta): void;
  onRateChanged?(hz: number): void;
  onClockStalled?(info: { sinceLastTickMs: number }): void;
  onGenerationBumped?(event: { fromGeneration: number; toGeneration: number }): void;
};

export type PageProjectionEngineOptions<TNode extends object = object> = {
  events: PageProjectionEngineEvents;
  scheduler: FrameClockScheduler;
  channel: PageToNodeChannel;
  treeQuery: FrameTreeQuery<TNode>;
  originHost: string;
  frameRateHz?: number;
  maxFrameBytes?: number;
  hiddenRateHz?: number;
  rateRecoverMs?: number;
  frameStallMs?: number;
  rateLadder?: readonly number[];
};

export class PageProjectionEngine<TNode extends object = object> {
  readonly identity = new IdentitySpace<TNode>();
  readonly mirror = new NodeMirror();
  readonly rewriter: UrlRewriter;
  readonly cssom = new CssomCoalescer();
  /** §5.6.6 — live WireOp frames buffered across establish (PP-EST-3). */
  readonly handoff = createEstablishHandoff<WireOp[]>();
  private readonly frame: FrameAccumulator<TNode>;
  private readonly clock: FrameClock;
  private sequence = 0;
  private generation = 1;
  /** §5.2.6 — set by the caller (`liveAttach.ts`) when title/lang/dir/viewport meta changes; emitted on the next tick alongside whatever else is dirty, then cleared. */
  private pendingDocumentState: DocumentStateOp | null = null;

  constructor(private readonly opts: PageProjectionEngineOptions<TNode>) {
    this.rewriter = new UrlRewriter({ originHost: opts.originHost });
    this.frame = new FrameAccumulator<TNode>(opts.treeQuery);
    this.clock = new FrameClock({
      scheduler: opts.scheduler,
      onTick: () => this.onClockTick(),
      onStall: (info) => opts.events.onClockStalled?.(info),
      frameRateHz: opts.frameRateHz,
      hiddenRateHz: opts.hiddenRateHz,
      rateRecoverMs: opts.rateRecoverMs,
      frameStallMs: opts.frameStallMs,
      rateLadder: opts.rateLadder,
    });
  }

  get currentGeneration(): number {
    return this.generation;
  }

  get currentSequence(): number {
    return this.sequence;
  }

  get rateHz(): number {
    return this.clock.rateHz;
  }

  start(): void {
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
  }

  /** Feed one `observe.ts` `DirtyState` snapshot into the accumulator. */
  ingestDirty(dirty: DirtyState): void {
    this.frame.absorb(dirty);
  }

  /** §5.2.6 — last-writer-wins; consumed (and cleared) by the next `onClockTick`, independent of DOM/Cssom dirtiness. */
  noteDocumentState(state: DocumentStateOp): void {
    this.pendingDocumentState = state;
  }

  /** §5.3.5.1 backpressure hook — degrades the rate ladder one step; never desyncs. */
  degradeRate(): void {
    this.clock.degrade();
    this.opts.events.onRateChanged?.(this.clock.rateHz);
  }

  /** §5.3.5.2 recovery hook — call periodically; steps up at most once per `rateRecoverMs`. */
  tryRecoverRate(): void {
    if (this.clock.recoverStep()) this.opts.events.onRateChanged?.(this.clock.rateHz);
  }

  /** §5.3.5.3 — client visibility report. */
  setHidden(hidden: boolean): void {
    this.clock.setHidden(hidden);
    this.opts.events.onRateChanged?.(this.clock.rateHz);
  }

  /** §5.3.4.4 watchdog — call periodically from the Node side. */
  checkClockStall(): boolean {
    return this.clock.checkStall();
  }

  /** T3/D4 — bump on a real top-level Document swap only; never on soft nav. */
  bumpGeneration(): number {
    const fromGeneration = this.generation;
    this.generation = this.identity.bumpGeneration();
    this.sequence = 0;
    this.mirror.clear();
    this.opts.events.onGenerationBumped?.({ fromGeneration, toGeneration: this.generation });
    return this.generation;
  }

  /** §5.6.6.a — open handoff before the establish walk; live ticks accumulate until drain. */
  beginEstablishHandoff(): void {
    openEstablishEpoch(this.handoff);
  }

  /** §5.6.6.b — walk snapshot captured; frames keep accumulating until establishEnd. */
  markEstablishSnapshot(): void {
    markSnapshotTaken(this.handoff);
  }

  /**
   * §5.6.6.c — after establishEnd is on the wire, emit buffered frames in order
   * (declarative childList / full patch — safe over the snapshot).
   */
  flushEstablishHandoff(): void {
    const frames = drainForEmitAfterEnd(this.handoff);
    for (const ops of frames) {
      const domOps = ops.filter((op): op is FrameOp =>
        op.op === 'childList' || op.op === 'patch' || op.op === 'scrollViewport' || op.op === 'scrollElement');
      this.mirror.applyFrame(domOps);
      this.sequence += 1;
      const meta: EncodedFrameMeta = { generation: this.generation, sequence: this.sequence };
      const parts = encodeFrame(ops, meta, this.opts.maxFrameBytes);
      pushFrameParts(this.opts.channel, parts);
      this.opts.events.onFrame(parts, meta);
    }
  }

  /**
   * §5.10 — full `cssomInstall` supersedes any CSSOM ops buffered during settle.
   * DOM/scroll frames stay queued for PP-EST-3 drain.
   */
  dropBufferedCssomFromHandoff(): void {
    if (this.handoff.phase !== 'accumulate' && this.handoff.phase !== 'snapshot') return;
    this.handoff.pendingFrames = this.handoff.pendingFrames
      .map((ops) =>
        ops.filter(
          (op) =>
            op.op !== 'cssomInstall'
            && op.op !== 'cssomSheetList'
            && op.op !== 'cssomRuleList'
            && op.op !== 'cssomPatch',
        ),
      )
      .filter((ops) => ops.length > 0);
  }

  get establishHandoffOpen(): boolean {
    return this.handoff.phase === 'accumulate' || this.handoff.phase === 'snapshot';
  }

  private onClockTick(): void {
    const domOps = this.frame.flush();
    const cssomOps = this.cssom.isEmpty ? [] : this.cssom.flush();
    const documentStateOp = this.pendingDocumentState;
    this.pendingDocumentState = null;
    if (domOps === null && cssomOps.length === 0 && documentStateOp === null) return; // PP-FR-4 — no ops, no sequence.

    const ops: WireOp[] = [...(domOps ?? []), ...cssomOps, ...(documentStateOp ? [documentStateOp] : [])];
    if (accumulateDuringEstablish(this.handoff, ops)) {
      // PP-EST-3 — do not emit or mutate the establish mirror until after establishEnd.
      return;
    }

    this.mirror.applyFrame(domOps ?? []);
    this.sequence += 1;
    const meta: EncodedFrameMeta = { generation: this.generation, sequence: this.sequence };
    const parts = encodeFrame(ops, meta, this.opts.maxFrameBytes);
    pushFrameParts(this.opts.channel, parts);
    this.opts.events.onFrame(parts, meta);
  }
}

export type { FrameOp, FrameTreeQuery } from './frame';
export type { CssomOp } from './cssom';
export type { DocumentStateOp } from './encode';
