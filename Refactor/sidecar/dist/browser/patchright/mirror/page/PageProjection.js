"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageProjectionEngine = void 0;
const identity_1 = require("./identity");
const frame_1 = require("./frame");
const clock_1 = require("./clock");
const encode_1 = require("./encode");
const cssom_1 = require("./cssom");
const establish_1 = require("./establish");
const channel_1 = require("./channel");
const mirror_1 = require("./node/mirror");
const rewrite_1 = require("./node/rewrite");
class PageProjectionEngine {
    opts;
    identity = new identity_1.IdentitySpace();
    mirror = new mirror_1.NodeMirror();
    rewriter;
    cssom = new cssom_1.CssomCoalescer();
    /** §5.6.6 — live WireOp frames buffered across establish (PP-EST-3). */
    handoff = (0, establish_1.createEstablishHandoff)();
    frame;
    clock;
    sequence = 0;
    generation = 1;
    /** §5.2.6 — set by the caller when title/lang/dir/viewport meta changes; emitted on the next tick alongside whatever else is dirty, then cleared. */
    pendingDocumentState = null;
    constructor(opts) {
        this.opts = opts;
        this.rewriter = new rewrite_1.UrlRewriter({ originHost: opts.originHost });
        this.frame = new frame_1.FrameAccumulator(opts.treeQuery);
        this.clock = new clock_1.FrameClock({
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
    get currentGeneration() {
        return this.generation;
    }
    get currentSequence() {
        return this.sequence;
    }
    get rateHz() {
        return this.clock.rateHz;
    }
    start() {
        this.clock.start();
    }
    stop() {
        this.clock.stop();
    }
    /** Feed one `observe.ts` `DirtyState` snapshot into the accumulator. */
    ingestDirty(dirty) {
        this.frame.absorb(dirty);
    }
    /** §5.2.6 — last-writer-wins; consumed (and cleared) by the next `onClockTick`, independent of DOM/Cssom dirtiness. */
    noteDocumentState(state) {
        this.pendingDocumentState = state;
    }
    /** §5.3.5.1 backpressure hook — degrades the rate ladder one step; never desyncs. */
    degradeRate() {
        this.clock.degrade();
        this.opts.events.onRateChanged?.(this.clock.rateHz);
    }
    /** §5.3.5.2 recovery hook — call periodically; steps up at most once per `rateRecoverMs`. */
    tryRecoverRate() {
        if (this.clock.recoverStep())
            this.opts.events.onRateChanged?.(this.clock.rateHz);
    }
    /** §5.3.5.3 — client visibility report. */
    setHidden(hidden) {
        this.clock.setHidden(hidden);
        this.opts.events.onRateChanged?.(this.clock.rateHz);
    }
    /** §5.3.4.4 watchdog — call periodically from the Node side. */
    checkClockStall() {
        return this.clock.checkStall();
    }
    /** T3/D4 — bump on a real top-level Document swap only; never on soft nav. */
    bumpGeneration() {
        const fromGeneration = this.generation;
        this.generation = this.identity.bumpGeneration();
        this.sequence = 0;
        this.mirror.clear();
        this.opts.events.onGenerationBumped?.({ fromGeneration, toGeneration: this.generation });
        return this.generation;
    }
    /** §5.6.6.a — open handoff before the establish walk; live ticks accumulate until drain. */
    beginEstablishHandoff() {
        (0, establish_1.openEstablishEpoch)(this.handoff);
    }
    /** §5.6.6.b — walk snapshot captured; frames keep accumulating until establishEnd. */
    markEstablishSnapshot() {
        (0, establish_1.markSnapshotTaken)(this.handoff);
    }
    /**
     * §5.6.6.c — after establishEnd is on the wire, emit buffered frames in order
     * (declarative childList / full patch — safe over the snapshot).
     */
    flushEstablishHandoff() {
        const frames = (0, establish_1.drainForEmitAfterEnd)(this.handoff);
        for (const ops of frames) {
            const domOps = ops.filter((op) => op.op === 'childList' || op.op === 'patch' || op.op === 'scrollViewport' || op.op === 'scrollElement');
            this.mirror.applyFrame(domOps);
            this.sequence += 1;
            const meta = { generation: this.generation, sequence: this.sequence };
            const parts = (0, encode_1.encodeFrame)(ops, meta, this.opts.maxFrameBytes);
            (0, channel_1.pushFrameParts)(this.opts.channel, parts);
            this.opts.events.onFrame(parts, meta);
        }
    }
    /**
     * §5.10 — full `cssomInstall` supersedes any CSSOM ops buffered during settle.
     * DOM/scroll frames stay queued for PP-EST-3 drain.
     */
    dropBufferedCssomFromHandoff() {
        if (this.handoff.phase !== 'accumulate' && this.handoff.phase !== 'snapshot')
            return;
        this.handoff.pendingFrames = this.handoff.pendingFrames
            .map((ops) => ops.filter((op) => op.op !== 'cssomInstall'
            && op.op !== 'cssomSheetList'
            && op.op !== 'cssomRuleList'
            && op.op !== 'cssomPatch'))
            .filter((ops) => ops.length > 0);
    }
    get establishHandoffOpen() {
        return this.handoff.phase === 'accumulate' || this.handoff.phase === 'snapshot';
    }
    onClockTick() {
        const domOps = this.frame.flush();
        const cssomOps = this.cssom.isEmpty ? [] : this.cssom.flush();
        const documentStateOp = this.pendingDocumentState;
        this.pendingDocumentState = null;
        if (domOps === null && cssomOps.length === 0 && documentStateOp === null)
            return; // PP-FR-4 — no ops, no sequence.
        const ops = [...(domOps ?? []), ...cssomOps, ...(documentStateOp ? [documentStateOp] : [])];
        if ((0, establish_1.accumulateDuringEstablish)(this.handoff, ops)) {
            // PP-EST-3 — do not emit or mutate the establish mirror until after establishEnd.
            return;
        }
        this.mirror.applyFrame(domOps ?? []);
        this.sequence += 1;
        const meta = { generation: this.generation, sequence: this.sequence };
        const parts = (0, encode_1.encodeFrame)(ops, meta, this.opts.maxFrameBytes);
        (0, channel_1.pushFrameParts)(this.opts.channel, parts);
        this.opts.events.onFrame(parts, meta);
    }
}
exports.PageProjectionEngine = PageProjectionEngine;
//# sourceMappingURL=PageProjection.js.map