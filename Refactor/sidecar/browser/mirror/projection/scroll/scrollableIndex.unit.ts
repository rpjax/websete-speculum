import assert from 'assert';
import { ScrollableIndex, isScrollableStyle } from '@speculum/page-projection/projected/scroll/scrollableIndex';

export function runScrollableIndexUnitTests(): void {
  assert.strictEqual(isScrollableStyle({ overflowY: 'auto' }), true);
  assert.strictEqual(isScrollableStyle({ overflow: 'hidden' }), false);

  const idx = new ScrollableIndex();
  idx.onNodeCreate(10, { overflowY: 'scroll' });
  assert.strictEqual(idx.has(10), true);
  idx.recheck(10, { overflowY: 'hidden' });
  assert.strictEqual(idx.has(10), false);
  idx.onNodeDrop(10);
  assert.strictEqual(idx.size, 0);
  console.log('[unit] scrollable index ok');
}
