"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runExtensionPlaneEnvelopeUnitTests = runExtensionPlaneEnvelopeUnitTests;
const assert_1 = __importDefault(require("assert"));
const envelope_1 = require("@speculum/page-projection/core/extensionPlane/envelope");
function runExtensionPlaneEnvelopeUnitTests() {
    assert_1.default.strictEqual(envelope_1.EXTENSION_PLANE_CHANNEL, 'speculum.extension.plane');
    const token = '550e8400-e29b-41d4-a716-446655440000';
    const bind = { channel: envelope_1.EXTENSION_PLANE_CHANNEL, token, kind: 'bind' };
    assert_1.default.deepStrictEqual((0, envelope_1.decodeExtensionPlaneEnvelope)(bind), bind);
    assert_1.default.ok((0, envelope_1.isExtensionPlaneWireMessage)(bind));
    const bytes = new Uint8Array([1, 2, 3]);
    const send = {
        channel: envelope_1.EXTENSION_PLANE_CHANNEL,
        token,
        kind: 'send',
        socketId: 1,
        bytes,
    };
    const decoded = (0, envelope_1.decodeExtensionPlaneEnvelope)(send);
    assert_1.default.ok(decoded && decoded.kind === 'send');
    if (decoded.kind === 'send') {
        assert_1.default.deepStrictEqual(Array.from(decoded.bytes), [1, 2, 3]);
    }
    assert_1.default.strictEqual((0, envelope_1.decodeExtensionPlaneEnvelope)({ channel: 'wrong', token, kind: 'bind' }), null);
    assert_1.default.strictEqual((0, envelope_1.decodeExtensionPlaneEnvelope)({ channel: envelope_1.EXTENSION_PLANE_CHANNEL, kind: 'bind' }), null);
    assert_1.default.strictEqual((0, envelope_1.decodeExtensionPlaneEnvelope)({ channel: envelope_1.EXTENSION_PLANE_CHANNEL, token, kind: 'open' }), null);
    console.log('[unit] extensionPlane envelope ok');
}
//# sourceMappingURL=extensionPlaneEnvelope.unit.js.map