import assert from 'assert';
import { EventApplier } from './EventApplier';
import { SidecarBuffer } from './SidecarBuffer';
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';

export async function runEventApplierUnitTests(): Promise<void> {
  const moves: Array<{ x: number; y: number }> = [];
  const buttons: Array<{ btn: string; down: boolean }> = [];
  const buffer = new SidecarBuffer();
  const applier = new EventApplier({
    buffer,
    pointer: {
      moveTo: (x, y) => moves.push({ x, y }),
      button: (btn, down) => buttons.push({ btn, down }),
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
  assert.strictEqual(buttons.length, 0, 'Phase A fail must not press');

  const moves2: Array<{ x: number; y: number }> = [];
  const buttons2: Array<{ btn: string; down: boolean }> = [];
  const applierOk = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: (x, y) => moves2.push({ x, y }),
      button: (btn, down) => buttons2.push({ btn, down }),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => true,
    applyScrollCensus: async () => ({ ok: true }),
  });
  applierOk.enqueue({ ...down, type: 'move' });
  applierOk.enqueue({ ...down, type: 'down' });
  await applierOk.flush();
  assert.deepStrictEqual(moves2[0], { x: 10, y: 20 });
  assert.ok(moves2.some((m) => m.x === 10 && m.y === 20));
  assert.ok(buttons2.some((b) => b.btn === 'left' && b.down === true));

  // Stale viewport stamp → drop
  const rejects: string[] = [];
  const applierStale = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: () => assert.fail('stale must not move'),
      button: () => assert.fail('stale must not click'),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => false,
    onReject: (code) => rejects.push(code),
  });
  applierStale.enqueue({
    schemaVersion: 1,
    type: 'move',
    viewportW: 1024,
    viewportH: 600,
    x: 1,
    y: 1,
  });
  await applierStale.flush();
  assert.ok(rejects.includes('stale_viewport'));

  console.log('[unit] EventApplier Phase A/B ok');
}
