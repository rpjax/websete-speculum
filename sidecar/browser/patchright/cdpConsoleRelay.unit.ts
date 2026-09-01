import assert from 'assert';
import {
  consoleApiLevel,
  formatConsoleApiArgs,
  formatConsoleRemoteObject,
  formatExceptionDetails,
} from './cdpConsoleRelay';

export function runCdpConsoleRelayUnitTests(): void {
  assert.strictEqual(consoleApiLevel('error'), 3);
  assert.strictEqual(consoleApiLevel('assert'), 3);
  assert.strictEqual(consoleApiLevel('warning'), 2);
  assert.strictEqual(consoleApiLevel('warn'), 2);
  assert.strictEqual(consoleApiLevel('log'), 1);

  assert.strictEqual(formatConsoleRemoteObject({ value: 'hi' }), 'hi');
  assert.strictEqual(formatConsoleRemoteObject({ value: 2 }), '2');
  assert.strictEqual(formatConsoleRemoteObject({ value: { a: 1 } }), '{"a":1}');
  assert.strictEqual(
    formatConsoleApiArgs([
      { value: 'warn-tag' },
      { value: '{"a":1}' },
    ]),
    'warn-tag {"a":1}',
  );
  assert.strictEqual(
    formatExceptionDetails({
      text: 'Uncaught',
      exception: { description: 'Error: boom\n    at x' },
    }),
    'Error: boom\n    at x',
  );
  console.log('[unit] cdp-console-relay ok');
}
