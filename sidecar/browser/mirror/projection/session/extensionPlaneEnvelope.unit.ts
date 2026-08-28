import assert from 'assert';
import {
  EXTENSION_PLANE_CHANNEL,
  decodeExtensionPlaneEnvelope,
  isExtensionPlaneWireMessage,
} from '@speculum/page-projection/core/extensionPlane/envelope';

export function runExtensionPlaneEnvelopeUnitTests(): void {
  assert.strictEqual(EXTENSION_PLANE_CHANNEL, 'speculum.extension.plane');

  const token = '550e8400-e29b-41d4-a716-446655440000';
  const bind = { channel: EXTENSION_PLANE_CHANNEL, token, kind: 'bind' as const };
  assert.deepStrictEqual(decodeExtensionPlaneEnvelope(bind), bind);
  assert.ok(isExtensionPlaneWireMessage(bind));

  const bytes = new Uint8Array([1, 2, 3]);
  const send = {
    channel: EXTENSION_PLANE_CHANNEL,
    token,
    kind: 'send' as const,
    socketId: 1,
    bytes,
  };
  const decoded = decodeExtensionPlaneEnvelope(send);
  assert.ok(decoded && decoded.kind === 'send');
  if (decoded.kind === 'send') {
    assert.deepStrictEqual(Array.from(decoded.bytes), [1, 2, 3]);
  }

  assert.strictEqual(decodeExtensionPlaneEnvelope({ channel: 'wrong', token, kind: 'bind' }), null);
  assert.strictEqual(decodeExtensionPlaneEnvelope({ channel: EXTENSION_PLANE_CHANNEL, kind: 'bind' }), null);
  assert.strictEqual(
    decodeExtensionPlaneEnvelope({ channel: EXTENSION_PLANE_CHANNEL, token, kind: 'open' }),
    null,
  );

  console.log('[unit] extensionPlane envelope ok');
}
