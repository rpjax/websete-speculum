import assert from 'assert';
import { EventApplier } from './EventApplier';
import { SidecarBuffer } from './SidecarBuffer';
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';

export async function runEventApplierUnitTests(): Promise<void> {
  const moves: Array<{ x: number; y: number }> = [];
  const buffer = new SidecarBuffer();
  const applier = new EventApplier({
    buffer,
    pointer: {
      moveTo: (x, y) => moves.push({ x, y }),
      button: () => {},
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => true,
    applyScrollCensus: async () => ({ ok: false, error: 'fail' }),
    onReject: () => {},
  });

  const down: UnifiedIntent = {
    schemaVersion: 1,
    type: 'down',
    viewportW: 800,
    viewportH: 600,
    x: 10,
    y: 20,
    button: 'left',
    census: { contexts: [] },
  };
  applier.enqueue(down);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(moves.length, 0, 'Phase A fail must skip Phase B');

  const applierOk = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: (x, y) => moves.push({ x, y }),
      button: () => {},
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => false,
    applyScrollCensus: async () => ({ ok: true }),
  });
  applierOk.enqueue({ ...down, type: 'move' });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(moves.length > 0);
  console.log('[unit] EventApplier Phase A/B ok');
}
