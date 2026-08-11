import { IdentitySpace } from './identity';
import { createDirtyState, type DirtyState } from './observe';
import { FrameAccumulator, type FrameOp, type FrameTreeQuery } from './frame';
import { FrameClock, type FrameClockScheduler } from './clock';
import { encodeFrame, type EncodedFrameMeta, type WireOp } from './encode';
import { CssomCoalescer } from './cssom';
import { createEstablishHandoff } from './establish';
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
};

export class PageProjectionEngine<TNode extends object = object> {
  readonly identity = new IdentitySpace<TNode>();
  readonly mirror = new NodeMirror();
  readonly rewriter: UrlRewriter;
  readonly cssom = new CssomCoalescer();
  readonly handoff = createEstablishHandoff<FrameOp[]>();
  private readonly frame: FrameAccumulator<TNode>;
  private readonly clock: FrameClock;
  private sequence = 0;
  private generation = 1;

  constructor(private readonly opts: PageProjectionEngineOptions<TNode>) {
    this.rewriter = new UrlRewriter({ originHost: opts.originHost });
    this.frame = new FrameAccumulator<TNode>(opts.treeQuery);
    this.clock = new FrameClock({
      scheduler: opts.scheduler,
      onTick: () => this.onClockTick(),
      onStall: (info) => opts.events.onClockStalled?.(info),
      frameRateHz: opts.frameRateHz,
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

  private onClockTick(): void {
    const domOps = this.frame.flush();
    const cssomOps = this.cssom.isEmpty ? [] : this.cssom.flush();
    if (domOps === null && cssomOps.length === 0) return; // PP-FR-4 — no ops, no sequence.

    const ops: WireOp[] = [...(domOps ?? []), ...cssomOps];
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
