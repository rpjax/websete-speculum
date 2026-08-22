"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInputIntentTypesUnitTests = runInputIntentTypesUnitTests;
const assert_1 = __importDefault(require("assert"));
const intentTypes_1 = require("@speculum/page-projection/core/input/intentTypes");
function runInputIntentTypesUnitTests() {
    const v2 = (0, intentTypes_1.normalizeDomInput)({
        type: 'mousedown',
        targetId: 42,
        generation: 3,
        payloadJson: '{"x":1}',
        contextId: 1,
    });
    assert_1.default.strictEqual(v2.schemaVersion, intentTypes_1.INTENT_SCHEMA_VERSION);
    assert_1.default.strictEqual(v2.contextId, 1);
    assert_1.default.strictEqual(v2.generation, 3);
    assert_1.default.strictEqual(v2.nodeId, 42);
    assert_1.default.strictEqual(v2.type, 'mousedown');
    assert_1.default.strictEqual(v2.payload, '{"x":1}');
    const fromNodeId = (0, intentTypes_1.normalizeDomInput)({
        type: 'input',
        nodeId: 7,
        payload: '{"value":"hi"}',
    });
    assert_1.default.strictEqual(fromNodeId.nodeId, 7);
    assert_1.default.strictEqual(fromNodeId.contextId, 1);
    const legacy = (0, intentTypes_1.intentV2ToLegacy)(v2);
    assert_1.default.strictEqual(legacy.targetId, 42);
    assert_1.default.strictEqual(legacy.payloadJson, '{"x":1}');
}
//# sourceMappingURL=intentTypes.unit.js.map