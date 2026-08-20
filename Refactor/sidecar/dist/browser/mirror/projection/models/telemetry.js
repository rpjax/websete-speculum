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
exports.CSSOM_POLL_STAT_KEYS = exports.TELEMETRY_BOOL_CAPS = exports.LAB_TELEMETRY_DEFAULTS = exports.DEFAULT_TELEMETRY_CONFIG = exports.TELEMETRY_WIRE_VERSION = void 0;
exports.emptyCssomPollStats = emptyCssomPollStats;
exports.countCssomOps = countCssomOps;
exports.stampCssomPoll = stampCssomPoll;
exports.isProjectionTelemetryMessage = isProjectionTelemetryMessage;
exports.desyncPhase = desyncPhase;
const opcodes_1 = require("./opcodes");
exports.TELEMETRY_WIRE_VERSION = 2;
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
exports.CSSOM_POLL_STAT_KEYS = [
    'source',
    'sequence',
    'pollMs',
    'identityWalkMs',
    'cssTextSerializeMs',
    'readableSheetCount',
    'unreadableSheetCount',
    'topLevelRulesVisited',
    'topLevelRulesSerialized',
    'styleTagTextUnchangedSheets',
    'rulesAppeared',
    'rulesDisappeared',
    'rulesTextChangedInPlace',
    'sheetsWithRuleListChanged',
    'sheetsAborted',
    'slotsSkipped',
    'idleSlices',
    'opCount',
    'opSheetNew',
    'opSheetDrop',
    'opSheetOrder',
    'opRuleNew',
    'opRuleDrop',
    'opRuleSet',
];
function emptyCssomPollStats() {
    return {
        source: 'idle',
        sequence: 0,
        pollMs: 0,
        identityWalkMs: 0,
        cssTextSerializeMs: 0,
        readableSheetCount: 0,
        unreadableSheetCount: 0,
        topLevelRulesVisited: 0,
        topLevelRulesSerialized: 0,
        styleTagTextUnchangedSheets: 0,
        rulesAppeared: 0,
        rulesDisappeared: 0,
        rulesTextChangedInPlace: 0,
        sheetsWithRuleListChanged: 0,
        sheetsAborted: 0,
        slotsSkipped: 0,
        idleSlices: 0,
        opCount: 0,
        opSheetNew: 0,
        opSheetDrop: 0,
        opSheetOrder: 0,
        opRuleNew: 0,
        opRuleDrop: 0,
        opRuleSet: 0,
    };
}
function countCssomOps(ops) {
    let opSheetNew = 0;
    let opSheetDrop = 0;
    let opSheetOrder = 0;
    let opRuleNew = 0;
    let opRuleDrop = 0;
    let opRuleSet = 0;
    for (let i = 0; i < ops.length; i++) {
        switch (ops[i].op) {
            case opcodes_1.OpCode.SheetNew:
                opSheetNew += 1;
                break;
            case opcodes_1.OpCode.SheetDrop:
                opSheetDrop += 1;
                break;
            case opcodes_1.OpCode.SheetOrder:
                opSheetOrder += 1;
                break;
            case opcodes_1.OpCode.RuleNew:
                opRuleNew += 1;
                break;
            case opcodes_1.OpCode.RuleDrop:
                opRuleDrop += 1;
                break;
            case opcodes_1.OpCode.RuleSet:
                opRuleSet += 1;
                break;
            default:
                break;
        }
    }
    return {
        opCount: opSheetNew + opSheetDrop + opSheetOrder + opRuleNew + opRuleDrop + opRuleSet,
        opSheetNew,
        opSheetDrop,
        opSheetOrder,
        opRuleNew,
        opRuleDrop,
        opRuleSet,
    };
}
function stampCssomPoll(stats, patch) {
    return { ...stats, ...patch };
}
function isProjectionTelemetryMessage(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    if (v.v !== exports.TELEMETRY_WIRE_VERSION || typeof v.kind !== 'string')
        return false;
    return typeof v.contextId === 'number' && Number.isInteger(v.contextId) && v.contextId >= 1;
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