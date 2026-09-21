import assert from 'node:assert';
import { pendingNestedHostAuditMessage } from '@speculum/page-projection/projected/pendingNestedHostAudit';

export function runPendingNestedHostAuditUnitTests(): void {
  const pending = new Map<number, number>([[2, 1]]);
  assert.strictEqual(
    pendingNestedHostAuditMessage(pending, {
      hasSession: () => false,
      hostNodeForContext: () => undefined,
      isHostMarked: () => false,
    }),
    null,
    'wire before host row must not desync',
  );

  assert.strictEqual(
    pendingNestedHostAuditMessage(pending, {
      hasSession: () => false,
      hostNodeForContext: () => 42,
      isHostMarked: () => false,
    })?.includes('not marked'),
    true,
  );

  assert.strictEqual(
    pendingNestedHostAuditMessage(pending, {
      hasSession: () => false,
      hostNodeForContext: () => 42,
      isHostMarked: () => true,
    })?.includes('never bound'),
    true,
  );

  console.log('[unit] pendingNestedHostAudit ok');
}
