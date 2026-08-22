/**
 * Eventual CSSOM poll: copy refs then hash the copy in `requestIdleCallback` batches.
 * Commit only when the pass finishes. {@link takePending} drains on the next frame-clock boundary.
 */

import type { CssomPlane, CssomScanResult } from './cssomPlane';
import { stampCssomPoll } from '../../models/telemetry';
import {
  foldSheetPieces,
  type CssomPoller,
  type SheetPollPiece,
  type SheetWalkState,
} from './cssomPoller';

type IdleDeadlineLike = { timeRemaining(): number };

export type CssomIdleSchedulerOptions = {
  poller: CssomPoller;
  /** Floor between pass starts (from `cssomPollHz`). */
  minIntervalMs: number;
  document?: Document;
  now?: () => number;
};

const SLICE_FLOOR_MS = 1;

export class CssomIdleScheduler implements CssomPlane {
  readonly enabled = true;
  private readonly poller: CssomPoller;
  private readonly minIntervalMs: number;
  private readonly doc: Document;
  private readonly now: () => number;

  private running = false;
  private ricId: number | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private pending: CssomScanResult | null = null;
  private pass: {
    startedAt: number;
    unreadableSheetCount: number;
    readable: { sheet: CSSStyleSheet; rules: CSSRuleList; hostNode: number }[];
    index: number;
    walk: SheetWalkState | null;
    pieces: SheetPollPiece[];
    textsBySheet: WeakMap<CSSStyleSheet, Map<object, string>>;
    idleSlices: number;
  } | null = null;
  private nextPassAfter = 0;

  constructor(opts: CssomIdleSchedulerOptions) {
    this.poller = opts.poller;
    this.minIntervalMs = opts.minIntervalMs;
    this.doc = opts.document ?? document;
    this.now = opts.now ?? (() => performance.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextPassAfter = 0;
    this.scheduleIdle();
  }

  halt(): void {
    this.stop();
  }

  stop(): void {
    this.running = false;
    this.cancelScheduled();
    this.pass = null;
    this.pending = null;
  }

  blockingScan(stashForEmit = false): CssomScanResult {
    this.cancelScheduled();
    this.pass = null;
    this.pending = null;
    const result = this.poller.poll(this.doc, stashForEmit ? 'live' : 'resync');
    const stamped = {
      ops: result.ops,
      stats: stampCssomPoll(result.stats, { source: stashForEmit ? 'snapshotScan' : 'resync' }),
    };
    if (stashForEmit) this.pending = stamped;
    if (this.running) this.scheduleIdle();
    return stamped;
  }

  /** Drain one completed pass for the frame pipe. Null if idle work is still in flight. */
  takePending(): CssomScanResult | null {
    const pending = this.pending;
    this.pending = null;
    if (pending !== null && this.running) this.scheduleIdle();
    return pending;
  }

  private scheduleIdle(): void {
    if (!this.running) return;
    if (this.pending !== null) return;
    this.cancelScheduled();
    const wait = Math.max(0, this.nextPassAfter - this.now());
    const go = (): void => {
      this.timerId = null;
      this.armRic();
    };
    if (wait > 0) {
      this.timerId = setTimeout(go, wait);
      return;
    }
    this.armRic();
  }

  private armRic(): void {
    if (!this.running) return;
    const ric = globalThis.requestIdleCallback;
    if (typeof ric === 'function') {
      this.ricId = ric((deadline) => this.onIdle(deadline), { timeout: this.minIntervalMs });
      return;
    }
    this.timerId = setTimeout(() => {
      this.onIdle({ timeRemaining: () => 8 });
    }, 0);
  }

  private cancelScheduled(): void {
    if (this.ricId !== null && typeof globalThis.cancelIdleCallback === 'function') {
      globalThis.cancelIdleCallback(this.ricId);
    }
    this.ricId = null;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private onIdle(deadline: IdleDeadlineLike): void {
    this.ricId = null;
    if (!this.running || this.pending !== null) return;

    if (this.pass === null) {
      const classified = this.poller.classifySheets(this.doc);
      this.pass = {
        startedAt: this.now(),
        unreadableSheetCount: classified.unreadableSheetCount,
        readable: classified.readable,
        index: 0,
        walk: null,
        pieces: [],
        textsBySheet: new WeakMap(),
        idleSlices: 0,
      };
    }

    const pass = this.pass;
    pass.idleSlices += 1;
    while (deadline.timeRemaining() > SLICE_FLOOR_MS) {
      if (pass.walk === null) {
        if (pass.index >= pass.readable.length) break;
        const { sheet, rules } = pass.readable[pass.index]!;
        pass.walk = this.poller.beginSheetWalk(sheet, rules);
      }
      const more = this.poller.hashSheetBatch(pass.walk, () => deadline.timeRemaining(), SLICE_FLOOR_MS);
      if (more) {
        this.armRic();
        return;
      }
      const piece = this.poller.finishSheetWalk(pass.walk);
      pass.pieces.push(piece);
      if (!piece.aborted) pass.textsBySheet.set(pass.walk.sheet, pass.walk.texts);
      pass.walk = null;
      pass.index += 1;
    }

    if (pass.index < pass.readable.length || pass.walk !== null) {
      this.armRic();
      return;
    }

    const ops = this.poller.commitPass(pass.readable, pass.pieces, pass.textsBySheet, 'live');
    this.pending = {
      ops,
      stats: foldSheetPieces(
        pass.unreadableSheetCount,
        pass.pieces,
        this.now() - pass.startedAt,
        { source: 'idle', idleSlices: pass.idleSlices, ops },
      ),
    };
    this.pass = null;
    this.nextPassAfter = this.now() + this.minIntervalMs;
  }
}
