"use strict";
/**
 * Projection telemetry wire messages (Virtual → sidecar on PlaneChannel.Telemetry;
 * lab client → session WS as `{ type: 'clientTelemetry' }`).
 *
 * v0 note: this is a deliberately small schema focused on the thing this lab increment
 * exists to measure — per-frame build/encode/apply cost and op volume for the new
 * table-replicated algorithm (frame-protocol.md §5). The old establish / handoff /
 * frameDecision / append-mode / parityFingerprint-dup schema is gone with the concepts
 * it described (establish no longer exists — frame-protocol.md §4.7).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TELEMETRY_BOOL_CAPS = exports.LAB_TELEMETRY_DEFAULTS = exports.DEFAULT_TELEMETRY_CONFIG = exports.TELEMETRY_WIRE_VERSION = void 0;
exports.isProjectionTelemetryMessage = isProjectionTelemetryMessage;
exports.desyncPhase = desyncPhase;
exports.TELEMETRY_WIRE_VERSION = 1;
exports.DEFAULT_TELEMETRY_CONFIG = {
    enabled: false,
    frameEmitted: true,
    transportDeferred: true,
    aggregate: true,
    applyResult: true,
    desync: true,
    applyOverrun: true,
    clock: true,
    cssomPoll: false,
    aggregateIntervalMs: 10_000,
};
/** Lab inject / UI default — everything on. */
exports.LAB_TELEMETRY_DEFAULTS = {
    enabled: true,
    frameEmitted: true,
    transportDeferred: true,
    aggregate: true,
    applyResult: true,
    desync: true,
    applyOverrun: true,
    clock: true,
    cssomPoll: true,
    aggregateIntervalMs: 2_000,
};
exports.TELEMETRY_BOOL_CAPS = [
    'enabled',
    'frameEmitted',
    'transportDeferred',
    'aggregate',
    'applyResult',
    'desync',
    'applyOverrun',
    'clock',
    'cssomPoll',
];
function isProjectionTelemetryMessage(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return v.v === exports.TELEMETRY_WIRE_VERSION && typeof v.kind === 'string';
}
function desyncPhase(errorCode) {
    switch (errorCode) {
        case 'malformed':
        case 'unknown_version':
            return 'decode';
        case 'missing_part':
            return 'assemble';
        case 'sequence_gap':
            return 'sequence';
        case 'generation_mismatch':
            return 'generation';
        default:
            return 'apply';
    }
}
//# sourceMappingURL=telemetry.js.map