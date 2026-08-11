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
    handoff = (0, establish_1.createEstablishHandoff)();
    frame;
    clock;
    sequence = 0;
    generation = 1;
    constructor(opts) {
        this.opts = opts;
        this.rewriter = new rewrite_1.UrlRewriter({ originHost: opts.originHost });
        this.frame = new frame_1.FrameAccumulator(opts.treeQuery);
        this.clock = new clock_1.FrameClock({
            scheduler: opts.scheduler,
            onTick: () => this.onClockTick(),
            onStall: (info) => opts.events.onClockStalled?.(info),
            frameRateHz: opts.frameRateHz,
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
    onClockTick() {
        const domOps = this.frame.flush();
        const cssomOps = this.cssom.isEmpty ? [] : this.cssom.flush();
        if (domOps === null && cssomOps.length === 0)
            return; // PP-FR-4 — no ops, no sequence.
        const ops = [...(domOps ?? []), ...cssomOps];
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