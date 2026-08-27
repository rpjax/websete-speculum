/**
 * Projected input capture — sparse-cdp only (hit-test nodeId; no pointermove / census).
 */

import assert from 'assert';
import {
  attachProjectedInputCapture,
  type ProjectedInputCaptureOptions,
} from '@speculum/page-projection/projected/input/projectedInputCapture';
import { PageProjectionRegistry } from '@speculum/page-projection/projected/registry';
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';

type Handler = (event: unknown) => void;

function fakeEventTarget() {
  const listeners = new Map<string, Set<Handler>>();
  return {
    addEventListener(type: string, handler: Handler, _opts?: unknown): void {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler);
    },
    removeEventListener(type: string, handler: Handler, _opts?: unknown): void {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type: string, event: unknown): void {
      for (const h of listeners.get(type) ?? []) h(event);
    },
    hasListener(type: string): boolean {
      return (listeners.get(type)?.size ?? 0) > 0;
    },
  };
}

function mockSurface(elementFromPoint?: (x: number, y: number) => unknown) {
  const win = { ...fakeEventTarget(), innerWidth: 800, innerHeight: 600 };
  const doc = {
    ...fakeEventTarget(),
    defaultView: win,
    scrollingElement: null,
    elementFromPoint: elementFromPoint ?? (() => null),
  };
  const surface = { ownerDocument: doc };
  return { win, doc, surface };
}

function baseOpts(overrides?: Partial<ProjectedInputCaptureOptions>): ProjectedInputCaptureOptions {
  return {
    contextId: 1,
    getGeneration: () => 1,
    getViewportSize: () => ({ width: 800, height: 600 }),
    isArmed: () => true,
    ...overrides,
  };
}

export async function runProjectedInputCaptureUnitTests(): Promise<void> {
  await testSparseNeverEmitsMove();
  await testSparseHitTestsNodeId();
  await testSparseMissFallsBackToNullNodeId();
  console.log('[unit] projectedInputCapture sparse ok');
}

/** Sparse must never register `pointermove` and never emit a `move` intent. */
async function testSparseNeverEmitsMove(): Promise<void> {
  const { doc, surface } = mockSurface();
  const sent: UnifiedIntent[] = [];
  const registry = new PageProjectionRegistry();
  const detach = attachProjectedInputCapture(
    surface as never,
    registry,
    (intent) => {
      sent.push(intent);
    },
    baseOpts(),
  );
  try {
    assert.strictEqual(doc.hasListener('pointermove'), false, 'sparse must not register pointermove');
    doc.dispatch('pointermove', { clientX: 10, clientY: 10 });
    doc.dispatch('pointermove', { clientX: 20, clientY: 20 });
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(sent.length, 0, 'sparse must never emit move');
  } finally {
    detach();
  }
}

/** Hit-test resolves registry nodeId on down. */
async function testSparseHitTestsNodeId(): Promise<void> {
  const target = {};
  const { doc, surface } = mockSurface(() => target);
  const sent: UnifiedIntent[] = [];
  const registry = new PageProjectionRegistry();
  registry.register(42, target as never);
  const detach = attachProjectedInputCapture(
    surface as never,
    registry,
    (intent) => {
      sent.push(intent);
    },
    baseOpts(),
  );
  try {
    doc.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 0 });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0]!.type, 'down');
    if (sent[0]!.type === 'down') {
      assert.strictEqual(sent[0]!.nodeId, 42);
      assert.strictEqual(sent[0]!.x, 5);
      assert.strictEqual(sent[0]!.y, 6);
    }
  } finally {
    detach();
  }
}

/** Empty-space hit falls back to `nodeId: null`. */
async function testSparseMissFallsBackToNullNodeId(): Promise<void> {
  const { doc, surface } = mockSurface(() => null);
  const sent: UnifiedIntent[] = [];
  const registry = new PageProjectionRegistry();
  const detach = attachProjectedInputCapture(
    surface as never,
    registry,
    (intent) => {
      sent.push(intent);
    },
    baseOpts(),
  );
  try {
    doc.dispatch('pointerup', { clientX: 1, clientY: 2, button: 0 });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 1);
    if (sent[0]!.type === 'up') {
      assert.strictEqual(sent[0]!.nodeId, null);
    }
  } finally {
    detach();
  }
}
