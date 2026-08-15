"use strict";
/**
 * Pipe: clock → DOM builder → encoder → transport.
 * Not the resync/snapshot algorithm — those live in `virtual/resync.ts` / `virtual/snapshot.ts`.
 * CSSOM CPU does not run here; {@link FrameEmitterOptions.takePendingCssom} attaches a finished
 * idle pass at the next tick (eventual, I5). A pending resync build blocking-scans CSSOM itself.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameEmitter = void 0;
exports.spliceCssomBeforeCheck = spliceCssomBeforeCheck;
const opcodes_1 = require("../../models/opcodes");
const frame_1 = require("../../models/frame");
const replicatedTableApply_1 = require("../../models/replicatedTableApply");
const IDLE_SWEEP_INTERVAL_TICKS = 30;
function spliceCssomBeforeCheck(ops, cssom) {
    if (cssom.length === 0)
        return ops;
    const last = ops[ops.length - 1];
    if (last !== undefined && last.op === opcodes_1.OpCode.Check) {
        return [...ops.slice(0, -1), ...cssom, last];
    }
    return [...ops, ...cssom];
}
class FrameEmitter {
    clock;
    buffer;
    builder;
    encoder;
    transport;
    census;
    telemetry;
    pullPendingMutations;
    takePendingCssom;
    table;
    sequence = 0;
    idleTicks = 0;
    pendingFrame = null;
    pendingParts = null;
    pendingPartIndex = 0;
    pendingRecords = null;
    pendingResyncBuild = null;
    constructor(opts) {
        this.clock = opts.clock;
        this.buffer = opts.buffer;
        this.builder = opts.builder;
        this.encoder = opts.encoder;
        this.transport = opts.transport;
        this.census = opts.census;
        this.telemetry = opts.telemetry ?? null;
        this.pullPendingMutations = opts.pullPendingMutations ?? null;
        this.takePendingCssom = opts.takePendingCssom ?? null;
        this.table = opts.table ?? null;
    }
    start() {
        this.clock.start(() => this.onBoundary());
    }
    stop() {
        this.clock.stop();
    }
    flushNow() {
        this.onBoundary();
    }
    get currentSequence() {
        return this.sequence;
    }
    async sendInitial(frame) {
        const parts = this.encoder.encode(frame);
        if (parts.length === 0)
            return;
        for (let i = 0; i < parts.length; i++) {
            const bytes = parts[i];
            let result = this.transport.send(bytes);
            let spins = 0;
            while (result === 'deferred' && spins < 50) {
                await new Promise((resolve) => setTimeout(resolve, 20));
                result = this.transport.send(bytes);
                spins += 1;
            }
        }
        let totalBytes = 0;
        for (let i = 0; i < parts.length; i++)
            totalBytes += parts[i].length;
        const snap = this.census();
        this.telemetry?.recordFrameEmitted({
            generation: frame.generation,
            sequence: frame.sequence,
            opCount: frame.ops.length,
            partCount: parts.length,
            bytes: totalBytes,
            tableSize: snap.tableSize,
            identitySize: snap.identitySize,
            buildMs: 0,
            encodeMs: 0,
        });
        this.sequence = frame.sequence;
    }
    requestResync(build) {
        this.pendingResyncBuild = build;
    }
    onBoundary() {
        this.pullPendingMutations?.();
        if (this.pendingParts !== null && this.pendingFrame !== null) {
            this.trySendPending();
            return;
        }
        if (this.pendingResyncBuild !== null) {
            const build = this.pendingResyncBuild;
            this.pendingResyncBuild = null;
            this.idleTicks = 0;
            this.builder.takeBuildStats?.();
            const frame = build(this.sequence + 1);
            const parts = this.encoder.encode(frame);
            if (parts.length === 0)
                return;
            this.pendingFrame = frame;
            this.pendingParts = parts;
            this.pendingPartIndex = 0;
            this.pendingRecords = null;
            this.trySendPending();
            return;
        }
        const cssom = this.takePendingCssom?.() ?? null;
        if (cssom !== null)
            this.telemetry?.recordCssomPoll(cssom.stats);
        const cssomOps = cssom?.ops ?? [];
        const hasDomWork = this.buffer.hasWork();
        if (!hasDomWork && cssomOps.length === 0) {
            this.idleTicks += 1;
            if (this.idleTicks < IDLE_SWEEP_INTERVAL_TICKS)
                return;
        }
        this.idleTicks = 0;
        const records = hasDomWork ? this.buffer.drain() : [];
        const nextSequence = this.sequence + 1;
        const snap = this.census();
        const preTableHash = this.table?.tableHash ?? 0n;
        const built = this.builder.build(records, {
            generation: snap.generation,
            sequence: nextSequence,
        });
        const unconsumed = this.builder.takeUnconsumedRecords?.();
        if (unconsumed && unconsumed.length > 0)
            this.buffer.reclaim(unconsumed);
        let ops = built?.ops ?? [];
        ops = spliceCssomBeforeCheck(ops, cssomOps);
        if (cssomOps.length > 0 && this.table !== null) {
            (0, replicatedTableApply_1.applyOpsToTable)(this.table, cssomOps);
        }
        const last = ops[ops.length - 1];
        if (last !== undefined && last.op === opcodes_1.OpCode.Check && this.table !== null) {
            last.hash = this.table.tableHash;
        }
        if (ops.length === 0)
            return;
        const frame = built === null
            ? (0, frame_1.createFrame)({
                generation: snap.generation,
                sequence: nextSequence,
                ops,
                preTableHash,
            })
            : { ...built, ops };
        const parts = this.encoder.encode(frame);
        if (parts.length === 0)
            return;
        this.pendingFrame = frame;
        this.pendingParts = parts;
        this.pendingPartIndex = 0;
        this.pendingRecords = null;
        this.trySendPending();
    }
    trySendPending() {
        const parts = this.pendingParts;
        const frame = this.pendingFrame;
        if (parts === null || frame === null)
            return;
        while (this.pendingPartIndex < parts.length) {
            const bytes = parts[this.pendingPartIndex];
            const result = this.transport.send(bytes);
            if (result === 'deferred') {
                this.telemetry?.recordTransportDeferred({
                    generation: frame.generation,
                    sequence: frame.sequence,
                    pendingParts: parts.length - this.pendingPartIndex,
                });
                return;
            }
            this.pendingPartIndex += 1;
        }
        let totalBytes = 0;
        for (let i = 0; i < parts.length; i++)
            totalBytes += parts[i].length;
        const stats = this.builder.takeBuildStats?.() ?? null;
        const snap = this.census();
        this.telemetry?.recordFrameEmitted({
            generation: frame.generation,
            sequence: frame.sequence,
            opCount: frame.ops.length,
            partCount: parts.length,
            bytes: totalBytes,
            tableSize: stats?.tableSize ?? snap.tableSize,
            identitySize: stats?.identitySize ?? snap.identitySize,
            buildMs: stats?.buildMs ?? 0,
            encodeMs: 0,
        });
        this.sequence = frame.sequence;
        this.pendingFrame = null;
        this.pendingParts = null;
        this.pendingPartIndex = 0;
        this.pendingRecords = null;
    }
}
exports.FrameEmitter = FrameEmitter;
//# sourceMappingURL=frameEmitter.js.map