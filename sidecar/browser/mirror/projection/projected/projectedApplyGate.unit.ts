import assert from 'node:assert';
import {
  PROJECTED_APPLY_GATE_MAX_PENDING,
  PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK,
  ProjectedApplyGate,
} from '@speculum/page-projection/projected/projectedApplyGate';
import type { AssembledFrame } from '@speculum/page-projection/core/decode';

function frame(sequence: number, generation = 1): AssembledFrame {
  return {
    version: 1,
    generation,
    sequence,
    resync: sequence === 1,
    contextId: 1,
    preTableHash: 0n,
    ops: [],
  } as AssembledFrame;
}

export async function runProjectedApplyGateUnitTests(): Promise<void> {
  const gate = new ProjectedApplyGate();
  const drained: number[] = [];

  gate.begin();
  assert.strictEqual(gate.blocked, true);
  gate.push(frame(2));
  gate.push(frame(3));
  gate.finishFlight((f) => drained.push(f.sequence));
  assert.deepStrictEqual(drained, [2, 3]);
  assert.strictEqual(gate.blocked, false);

  const discardGate = new ProjectedApplyGate();
  const afterDiscard: number[] = [];
  discardGate.begin();
  discardGate.push(frame(4));
  discardGate.discardPending();
  discardGate.finishFlight((f) => afterDiscard.push(f.sequence));
  assert.deepStrictEqual(afterDiscard, []);

  let overflow = false;
  const capped = new ProjectedApplyGate({
    maxPending: 2,
    onOverflow: () => {
      overflow = true;
    },
  });
  const afterOverflow: number[] = [];
  capped.begin();
  capped.push(frame(2));
  capped.push(frame(3));
  capped.push(frame(4));
  assert.strictEqual(overflow, true);
  capped.finishFlight((f) => afterOverflow.push(f.sequence));
  assert.deepStrictEqual(afterOverflow, []);

  const nested = new ProjectedApplyGate();
  const afterNestedInner: number[] = [];
  const afterNestedOuter: number[] = [];
  nested.begin();
  nested.push(frame(5));
  nested.begin();
  nested.finishFlight((f) => afterNestedInner.push(f.sequence));
  assert.deepStrictEqual(afterNestedInner, []);
  assert.strictEqual(nested.blocked, true);
  nested.finishFlight((f) => afterNestedOuter.push(f.sequence));
  assert.deepStrictEqual(afterNestedOuter, [5]);

  gate.clear();
  assert.strictEqual(gate.blocked, false);
  assert.strictEqual(PROJECTED_APPLY_GATE_MAX_PENDING, 64);
  assert.strictEqual(PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK, 3);

  console.log('[unit] projectedApplyGate ok');
}
