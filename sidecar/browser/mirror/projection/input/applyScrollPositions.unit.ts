/**
 * applyScrollPositions — frac × range → px (same frac, different ranges).
 */

import assert from 'assert';
import { scrollPxFromFrac } from '@speculum/page-projection/virtual/input/applyScrollPositions';

export async function runApplyScrollPositionsUnitTests(): Promise<void> {
  // Owner accept cases (deterministic; no session):
  //   range 6696, frac 0.561 → 3756.456 (plan wrote 3757; contract is frac*range, no round)
  //   range 7576, frac 0.561 → 4250.136 (plan wrote 4250)
  //   range 0 → 0
  assert.strictEqual(scrollPxFromFrac(0.561, 6696), 0.561 * 6696);
  assert.strictEqual(scrollPxFromFrac(0.561, 7576), 0.561 * 7576);
  assert.notStrictEqual(
    scrollPxFromFrac(0.561, 6696),
    scrollPxFromFrac(0.561, 7576),
    'same frac on different ranges must yield different px',
  );
  assert.strictEqual(scrollPxFromFrac(0.561, 0), 0);
  assert.strictEqual(scrollPxFromFrac(1, 0), 0);
  assert.strictEqual(scrollPxFromFrac(0, 6696), 0);
  console.log('[unit] applyScrollPositions frac→px ok');
}
