"use strict";
/**
 * Projection telemetry wire messages (Virtual → sidecar on PlaneChannel.Telemetry;
 * lab client → session WS as `{ type: 'clientTelemetry' }`).
 *
 * Default-on facts stay frame-unit and cheap (E8). Decision / parity packs MUST
 * early-return before allocation when their capability is off.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TELEMETRY_BOOL_CAPS = exports.LAB_TELEMETRY_DEFAULTS = exports.DEFAULT_TELEMETRY_CONFIG = exports.CHILD_LIST_FACT_CAP = exports.TELEMETRY_WIRE_VERSION = void 0;
exports.isProjectionTelemetryMessage = isProjectionTelemetryMessage;
exports.desyncPhase = desyncPhase;
exports.isRepeatedConcat = isRepeatedConcat;
exports.TELEMETRY_WIRE_VERSION = 1;
/** Max childList decision rows in one `frameDecision` / apply note. */
exports.CHILD_LIST_FACT_CAP = 32;
exports.DEFAULT_TELEMETRY_CONFIG = {
    enabled: false,
    frameEmitted: true,
    transportDeferred: true,
    aggregate: true,
    establish: true,
    builderStats: true,
    applyResult: true,
    desync: true,
    applyOverrun: true,
    clock: true,
    frameDecision: false,
    parityFingerprint: false,
    encoder: false,
    handoff: true,
    aggregateIntervalMs: 10_000,
};
/** Lab inject / UI default — full decision pack on. */
exports.LAB_TELEMETRY_DEFAULTS = {
    enabled: true,
    frameEmitted: true,
    transportDeferred: true,
    aggregate: true,
    establish: true,
    builderStats: true,
    applyResult: true,
    desync: true,
    applyOverrun: true,
    clock: true,
    frameDecision: true,
    parityFingerprint: true,
    encoder: true,
    handoff: true,
    aggregateIntervalMs: 2_000,
};
exports.TELEMETRY_BOOL_CAPS = [
    'enabled',
    'frameEmitted',
    'transportDeferred',
    'aggregate',
    'establish',
    'builderStats',
    'applyResult',
    'desync',
    'applyOverrun',
    'clock',
    'frameDecision',
    'parityFingerprint',
    'encoder',
    'handoff',
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
        case 'establish_checksum':
            return 'establish';
        case 'sequence_gap':
            return 'sequence';
        case 'generation_mismatch':
            return 'generation';
        default:
            return 'apply';
    }
}
/** Concatenated-twice detector (`Lab fixtureLab fixture`). */
function isRepeatedConcat(value) {
    const t = value.trim();
    if (t.length < 4)
        return false;
    if (t.length % 2 !== 0)
        return false;
    const mid = t.length / 2;
    return t.slice(0, mid) === t.slice(mid);
}
//# sourceMappingURL=telemetry.js.map