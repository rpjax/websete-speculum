"use strict";
/**
 * Virtual-side projection telemetry — push-active on DataPlane Telemetry channel.
 * Producer-only message kinds (frameEmitted / transportDeferred / aggregate / clock);
 * `applyResult` / `desynced` / `applyOverrun` are client-emitted and relayed by the lab
 * session, not created here (models/telemetry.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectionTelemetry = void 0;
const plane_1 = require("../../plane");
class ProjectionTelemetry {
    config;
    dataPlane;
    now;
    textEncoder = new TextEncoder();
    framesEmitted = 0;
    opsEmitted = 0;
    partsAccepted = 0;
    bytesAccepted = 0;
    deferredCount = 0;
    lastSequence = 0;
    buildMsSum = 0;
    encodeMsSum = 0;
    aggregateTimer = null;
    constructor(opts) {
        this.config = opts.config;
        this.dataPlane = opts.dataPlane;
        this.now = opts.now ?? (() => performance.now());
    }
    start() {
        if (!this.config.enabled || !this.config.aggregate)
            return;
        if (this.aggregateTimer !== null)
            return;
        this.aggregateTimer = setInterval(() => this.pushAggregate(), this.config.aggregateIntervalMs);
    }
    stop() {
        if (this.aggregateTimer !== null) {
            clearInterval(this.aggregateTimer);
            this.aggregateTimer = null;
        }
    }
    recordFrameEmitted(info) {
        if (!this.config.enabled)
            return;
        this.framesEmitted += 1;
        this.opsEmitted += info.opCount;
        this.partsAccepted += info.partCount;
        this.bytesAccepted += info.bytes;
        this.lastSequence = info.sequence;
        this.buildMsSum += info.buildMs;
        this.encodeMsSum += info.encodeMs;
        if (!this.config.frameEmitted)
            return;
        this.push({
            v: 1,
            kind: 'frameEmitted',
            t: this.now(),
            generation: info.generation,
            sequence: info.sequence,
            opCount: info.opCount,
            partCount: info.partCount,
            bytes: info.bytes,
            tableSize: info.tableSize,
            identitySize: info.identitySize,
            buildMs: info.buildMs,
            encodeMs: info.encodeMs,
        });
    }
    recordTransportDeferred(info) {
        if (!this.config.enabled)
            return;
        this.deferredCount += 1;
        if (!this.config.transportDeferred)
            return;
        this.push({
            v: 1,
            kind: 'transportDeferred',
            t: this.now(),
            generation: info.generation,
            sequence: info.sequence,
            pendingParts: info.pendingParts,
        });
    }
    recordClockStalled(info) {
        if (!this.config.enabled || !this.config.clock)
            return;
        this.push({
            v: 1,
            kind: 'clockStalled',
            t: this.now(),
            sinceLastTickMs: info.sinceLastTickMs,
            rateHz: info.rateHz,
        });
    }
    recordRateChanged(info) {
        if (!this.config.enabled || !this.config.clock)
            return;
        this.push({
            v: 1,
            kind: 'rateChanged',
            t: this.now(),
            fromHz: info.fromHz,
            toHz: info.toHz,
            reason: info.reason,
        });
    }
    recordCssomPoll(info) {
        if (!this.config.enabled || !this.config.cssomPoll)
            return;
        this.push({
            v: 1,
            kind: 'cssomPoll',
            t: this.now(),
            ...info,
        });
    }
    pushAggregate() {
        if (!this.config.enabled || !this.config.aggregate)
            return;
        this.push({
            v: 1,
            kind: 'aggregate',
            t: this.now(),
            framesEmitted: this.framesEmitted,
            opsEmitted: this.opsEmitted,
            partsAccepted: this.partsAccepted,
            bytesAccepted: this.bytesAccepted,
            deferredCount: this.deferredCount,
            lastSequence: this.lastSequence,
            avgBuildMs: this.framesEmitted > 0 ? this.buildMsSum / this.framesEmitted : 0,
            avgEncodeMs: this.framesEmitted > 0 ? this.encodeMsSum / this.framesEmitted : 0,
        });
    }
    push(message) {
        const plane = this.dataPlane;
        if (plane === null || !plane.isOpen)
            return;
        const bytes = this.textEncoder.encode(JSON.stringify(message));
        void plane.send(plane_1.PlaneChannel.Telemetry, bytes);
    }
}
exports.ProjectionTelemetry = ProjectionTelemetry;
//# sourceMappingURL=projectionTelemetry.js.map