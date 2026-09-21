import assert from 'node:assert';
import { ProjectedApplyGate } from '@speculum/page-projection/projected/projectedApplyGate';
import type { AssembledFrame } from '@speculum/page-projection/core/decode';

/**
 * Post-drain lag contract (ProjectionClient / NestedProjectedApply):
 * evaluate `highestSeen > lastSequence` only after finishFlight drain — never at swap.
 */
function frame(sequence: number, generation = 1): AssembledFrame {
  return {
    version: 1,
    generation,
    sequence,
    resync: false,
    contextId: 1,
    preTableHash: 0n,
    ops: [],
  } as AssembledFrame;
}

function simulatePostDrainLag(opts: {
  swapSequence: number;
  pendingSequences: number[];
  /** Wire high-water if greater than pending (overflow dropped tail). */
  wireHighestSeen?: number;
  overflowCap?: number;
}): { lastSequence: number; highestSeen: number; lagRequests: number; drained: number[] } {
  let lastSequence = opts.swapSequence;
  let highestSeen = opts.swapSequence;
  let lagRequests = 0;
  const drained: number[] = [];

  const gate = new ProjectedApplyGate({
    maxPending: opts.overflowCap,
    onFlightEnd: () => {
      // Same moment as ProjectionClient.handleApplyGateFlightEnd (after drainLoop).
      if (highestSeen > lastSequence) lagRequests += 1;
    },
  });

  gate.begin();
  for (const seq of opts.pendingSequences) {
    highestSeen = Math.max(highestSeen, seq);
    gate.push(frame(seq));
  }
  if (opts.wireHighestSeen !== undefined) {
    highestSeen = Math.max(highestSeen, opts.wireHighestSeen);
  }
  // commitResyncSwap would run here — must NOT request lag yet.
  assert.strictEqual(lagRequests, 0, 'lag must not fire at swap (pre-drain)');

  gate.finishFlight((f) => {
    drained.push(f.sequence);
    lastSequence = f.sequence;
  });

  return { lastSequence, highestSeen, lagRequests, drained };
}

export async function runLagCatchUpOrderUnitTests(): Promise<void> {
  // Drain closes the gap → zero lag wholesale.
  {
    const pending = Array.from({ length: 40 }, (_, i) => 11 + i); // 11..50
    const r = simulatePostDrainLag({ swapSequence: 10, pendingSequences: pending });
    assert.deepStrictEqual(r.drained, pending);
    assert.strictEqual(r.lastSequence, 50);
    assert.strictEqual(r.highestSeen, 50);
    assert.strictEqual(r.lagRequests, 0);
  }

  // Contiguous drain stops short of wire high-water → exactly one lag after flight.
  {
    const r = simulatePostDrainLag({
      swapSequence: 10,
      pendingSequences: [11, 12, 13, 14, 15],
      wireHighestSeen: 20,
    });
    assert.strictEqual(r.lastSequence, 15);
    assert.strictEqual(r.highestSeen, 20);
    assert.strictEqual(r.lagRequests, 1);
  }

  // Overflow wipes pending; high-water still ahead → one lag after empty drain.
  {
    const r = simulatePostDrainLag({
      swapSequence: 10,
      pendingSequences: [11, 12, 13],
      overflowCap: 2,
      wireHighestSeen: 30,
    });
    assert.deepStrictEqual(r.drained, []);
    assert.strictEqual(r.lastSequence, 10);
    assert.ok(r.highestSeen >= 12);
    assert.strictEqual(r.lagRequests, 1);
  }

  // Live page stays behind across many flights — wholesale lag is one shot.
  {
    let lastSequence = 10;
    const highestSeen = 80;
    let lagRequests = 0;
    let consumed = 0;
    const gate = new ProjectedApplyGate({
      onFlightEnd: () => {
        if (highestSeen > lastSequence && consumed < 1) {
          lagRequests += 1;
          consumed += 1;
        }
      },
    });
    for (let i = 0; i < 8; i++) {
      gate.begin();
      lastSequence += 1;
      gate.finishFlight(() => {});
    }
    assert.strictEqual(lagRequests, 1);
  }

  console.log('[unit] lagCatchUpOrder ok');
}
