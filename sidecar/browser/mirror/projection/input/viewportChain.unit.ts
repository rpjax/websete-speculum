import assert from 'assert';
import {
  composePointToRoot,
  mapPointAcrossHop,
  type ViewportHop,
} from '@speculum/page-projection/core/input/viewportChain';
import { ContextLineageIndex } from '@speculum/page-projection/virtual/dom/contextLineage';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';

export function runViewportChainUnitTests(): void {
  const hop: ViewportHop = { dx: 24, dy: 304, scale: 1 };
  const mapped = mapPointAcrossHop(150, 32, hop);
  assert.strictEqual(mapped.x, 174);
  assert.strictEqual(mapped.y, 336);

  const scaledHop: ViewportHop = { dx: 10, dy: 20, scale: 0.8 };
  const scaled = mapPointAcrossHop(100, 50, scaledHop);
  assert.strictEqual(scaled.x, 90);
  assert.strictEqual(scaled.y, 60);

  const composed = composePointToRoot(50, 40, [hop]);
  assert.strictEqual(composed.x, 74);
  assert.strictEqual(composed.y, 344);

  const lineage = new ContextLineageIndex();
  lineage.register(2, CONTEXT_ID_ROOT);
  lineage.register(3, 2);
  assert.deepStrictEqual(lineage.chainLeafToRoot(3), [3, 2]);
  assert.strictEqual(lineage.directChildOfRootOnPath(3), 2);
  assert.strictEqual(lineage.directChildOfRootOnPath(2), 2);

  console.log('[unit] viewport chain compose ok');
}
