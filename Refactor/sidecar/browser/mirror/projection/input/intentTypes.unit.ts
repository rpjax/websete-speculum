import assert from 'assert';
import { normalizeDomInput, intentV2ToLegacy, INTENT_SCHEMA_VERSION } from '@speculum/page-projection/core/input/intentTypes';

export function runInputIntentTypesUnitTests(): void {
  const v2 = normalizeDomInput({
    type: 'mousedown',
    targetId: 42,
    generation: 3,
    payloadJson: '{"x":1}',
    contextId: 1,
  });
  assert.strictEqual(v2.schemaVersion, INTENT_SCHEMA_VERSION);
  assert.strictEqual(v2.contextId, 1);
  assert.strictEqual(v2.generation, 3);
  assert.strictEqual(v2.nodeId, 42);
  assert.strictEqual(v2.type, 'mousedown');
  assert.strictEqual(v2.payload, '{"x":1}');

  const fromNodeId = normalizeDomInput({
    type: 'input',
    nodeId: 7,
    payload: '{"value":"hi"}',
  });
  assert.strictEqual(fromNodeId.nodeId, 7);
  assert.strictEqual(fromNodeId.contextId, 1);

  const legacy = intentV2ToLegacy(v2);
  assert.strictEqual(legacy.targetId, 42);
  assert.strictEqual(legacy.payloadJson, '{"x":1}');
}
