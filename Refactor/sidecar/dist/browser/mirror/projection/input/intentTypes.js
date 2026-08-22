"use strict";
/**
 * PageProjection intent envelope V2 — input plane only (not frame ISA).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTENT_SCHEMA_VERSION = void 0;
exports.normalizeDomInput = normalizeDomInput;
exports.intentV2ToLegacy = intentV2ToLegacy;
exports.isPageProjectionIntentV2 = isPageProjectionIntentV2;
const frame_1 = require("../core/frame");
exports.INTENT_SCHEMA_VERSION = 1;
function normalizeDomInput(raw) {
    const nodeId = raw.nodeId ?? raw.targetId ?? null;
    const payload = raw.payload ?? raw.payloadJson ?? '{}';
    return {
        schemaVersion: exports.INTENT_SCHEMA_VERSION,
        contextId: raw.contextId && raw.contextId > 0 ? raw.contextId : frame_1.CONTEXT_ID_ROOT,
        generation: raw.generation ?? 0,
        type: raw.type.trim(),
        nodeId: nodeId != null && nodeId > 0 ? nodeId : null,
        timestampClient: raw.timestampClient ?? null,
        payload,
    };
}
function intentV2ToLegacy(intent) {
    return {
        type: intent.type,
        targetId: intent.nodeId,
        generation: intent.generation,
        timestampClient: intent.timestampClient,
        payloadJson: intent.payload,
        contextId: intent.contextId,
    };
}
function isPageProjectionIntentV2(raw) {
    if (!raw || typeof raw !== 'object')
        return false;
    const o = raw;
    return (o.schemaVersion === exports.INTENT_SCHEMA_VERSION
        && typeof o.contextId === 'number'
        && typeof o.generation === 'number'
        && typeof o.type === 'string'
        && (o.nodeId === null || typeof o.nodeId === 'number')
        && typeof o.payload === 'string');
}
//# sourceMappingURL=intentTypes.js.map