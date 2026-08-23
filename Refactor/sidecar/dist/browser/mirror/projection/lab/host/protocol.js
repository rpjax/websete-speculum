"use strict";
/**
 * Lab control WebSocket protocol v1 (lab-design.md §8.6).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAB_PROTOCOL_VERSION = void 0;
exports.parseClientMessage = parseClientMessage;
exports.LAB_PROTOCOL_VERSION = 1;
function parseClientMessage(raw) {
    if (!raw || typeof raw !== 'object')
        return { error: 'invalid JSON control message', code: 'invalid_json' };
    const msg = raw;
    const type = msg.type;
    if (typeof type !== 'string')
        return { error: 'missing type', code: 'unknown_type' };
    switch (type) {
        case 'hello':
        case 'browse.start':
        case 'browse.stop':
        case 'browse.navigate':
        case 'run.start':
        case 'run.abort':
        case 'surface.clear':
        case 'client.telemetry':
        case 'client.snapshotResult':
        case 'client.requestResync':
        case 'client.intent':
        case 'client.tamperResult':
        case 'client.injectResult':
        case 'client.resize':
        case 'client.snapshot':
        case 'client.validateSnaps':
            return msg;
        default:
            return { error: `unknown control type: ${type}`, code: 'unknown_type' };
    }
}
//# sourceMappingURL=protocol.js.map