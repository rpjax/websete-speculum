"use strict";
/**
 * Map wire / DomInputIngress → UnifiedIntent (schemaVersion ≥ 1 unified types).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingressToUnifiedIntent = ingressToUnifiedIntent;
const unifiedIntentTypes_1 = require("@speculum/page-projection/core/input/unifiedIntentTypes");
function parsePayload(raw) {
    if (!raw)
        return {};
    try {
        const v = JSON.parse(raw);
        if (v && typeof v === 'object' && !Array.isArray(v))
            return v;
    }
    catch {
        /* */
    }
    return {};
}
function parseCensus(raw) {
    if (!raw)
        return undefined;
    if (typeof raw === 'object')
        return raw;
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function buttonName(v) {
    if (v === 'middle' || v === 1)
        return 'middle';
    if (v === 'right' || v === 2)
        return 'right';
    return 'left';
}
/** Accept unified types and legacy V2 aliases on the same ingress. */
function ingressToUnifiedIntent(raw) {
    const type = raw.type.trim();
    const payload = parsePayload(raw.payload ?? raw.payloadJson);
    const viewportW = Number(raw.viewportW ?? payload.viewportW ?? 0);
    const viewportH = Number(raw.viewportH ?? payload.viewportH ?? 0);
    const x = Number(raw.x ?? payload.x ?? 0);
    const y = Number(raw.y ?? payload.y ?? 0);
    const census = parseCensus(raw.census ?? payload.census);
    const mapLegacy = (t) => {
        if (t === 'mousemove')
            return 'move';
        if (t === 'mousedown')
            return 'down';
        if (t === 'mouseup')
            return 'up';
        if (t === 'keydown')
            return 'keyDown';
        if (t === 'keyup')
            return 'keyUp';
        if (t === 'scrollViewport' || t === 'scrollelement' || t === 'scrollElement')
            return 'scrollSet';
        return t;
    };
    const unifiedType = mapLegacy(type);
    if (unifiedType === 'move' || unifiedType === 'down' || unifiedType === 'up') {
        return {
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type: unifiedType,
            timestampClient: raw.timestampClient ?? undefined,
            viewportW,
            viewportH,
            x,
            y,
            button: buttonName(raw.button ?? payload.button),
            census: unifiedType === 'move' ? undefined : census,
        };
    }
    if (unifiedType === 'keyDown' || unifiedType === 'keyUp') {
        return {
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type: unifiedType,
            timestampClient: raw.timestampClient ?? undefined,
            key: String(raw.key ?? payload.key ?? ''),
            code: String(raw.code ?? payload.code ?? ''),
            modifiers: payload.modifiers ?? undefined,
        };
    }
    if (unifiedType === 'scrollSet') {
        const nodeId = raw.nodeId ?? raw.targetId ?? null;
        return {
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type: 'scrollSet',
            timestampClient: raw.timestampClient ?? undefined,
            contextId: raw.contextId && raw.contextId > 0 ? raw.contextId : 1,
            nodeId: nodeId != null && nodeId > 0 ? nodeId : null,
            scrollX: Number(raw.scrollX ?? payload.scrollX ?? payload.scrollLeft ?? 0),
            scrollY: Number(raw.scrollY ?? payload.scrollY ?? payload.scrollTop ?? 0),
        };
    }
    if (unifiedType === 'setFiles') {
        const nodeId = raw.nodeId ?? raw.targetId;
        if (nodeId == null || nodeId <= 0)
            return null;
        return {
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type: 'setFiles',
            timestampClient: raw.timestampClient ?? undefined,
            contextId: raw.contextId && raw.contextId > 0 ? raw.contextId : 1,
            nodeId,
            files: payload.files ?? payload,
        };
    }
    return null;
}
//# sourceMappingURL=ingressToUnifiedIntent.js.map