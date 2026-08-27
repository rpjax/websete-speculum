/**
 * `capturePolicy` split (Fase 2.5) — 'peripheral' (default) still registers `pointermove`
 * and coalesces moves exactly as before; 'sparse' never registers `pointermove` and never
 * emits a `move` intent, even when the surface receives synthetic pointermove events.
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
  await testPeripheralPolicyRegistersAndCoalescesMove();
  await testSparsePolicyNeverEmitsMove();
  await testSparsePolicyHitTestsNodeIdAndSkipsCensus();
  await testSparsePolicyMissFallsBackToNullNodeId();
  console.log('[unit] projectedInputCapture capturePolicy ok');
}

/** Default (omitted `capturePolicy`) must stay 100% identical to pre-Fase-2 behaviour. */
async function testPeripheralPolicyRegistersAndCoalescesMove(): Promise<void> {
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
    assert.strictEqual(doc.hasListener('pointermove'), true, 'default policy must register pointermove');
    // Coalesce: two rapid moves within the 50ms window collapse to the last one.
    doc.dispatch('pointermove', { clientX: 10, clientY: 10 });
    doc.dispatch('pointermove', { clientX: 20, clientY: 20 });
    assert.strictEqual(sent.length, 0, 'move must not fire before the 50ms coalesce window');
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(sent.length, 1, 'coalesced move must fire exactly once');
    assert.strictEqual(sent[0]!.type, 'move');
    if (sent[0]!.type === 'move') {
      assert.strictEqual(sent[0]!.x, 20);
      assert.strictEqual(sent[0]!.y, 20);
    }
  } finally {
    detach();
  }
}

/**
 * `sparse-cdp` alternate pipeline (decision-log.md 2026-08-27) — `sparse` policy hit-tests
 * the click locally and addresses it by nodeId, never runs S6 census/sync at all.
 */
async function testSparsePolicyHitTestsNodeIdAndSkipsCensus(): Promise<void> {
  const target = {};
  const { doc, surface } = mockSurface(() => target);
  const sent: UnifiedIntent[] = [];
  const registry = new PageProjectionRegistry();
  registry.register(42, target as never);
  let censusCalls = 0;
  const detach = attachProjectedInputCapture(
    surface as never,
    registry,
    (intent) => {
      sent.push(intent);
    },
    baseOpts({
      capturePolicy: 'sparse',
      requestScrollCensus: async () => {
        censusCalls += 1;
        return { contexts: [] };
      },
    }),
  );
  try {
    doc.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 0 });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0]!.type, 'down');
    assert.strictEqual(censusCalls, 0, 'sparse must never request a scroll census');
    if (sent[0]!.type === 'down') {
      assert.strictEqual(sent[0]!.nodeId, 42, 'must resolve the hit-tested element to its registry nodeId');
      assert.strictEqual(sent[0]!.census, undefined, 'sparse must never attach a census');
      assert.strictEqual(sent[0]!.x, 5);
      assert.strictEqual(sent[0]!.y, 6);
    }
  } finally {
    detach();
  }
}

/** `sparse` policy on an empty-space hit (no element under the point) falls back to `nodeId: null`. */
async function testSparsePolicyMissFallsBackToNullNodeId(): Promise<void> {
  const { doc, surface } = mockSurface(() => null);
  const sent: UnifiedIntent[] = [];
  const registry = new PageProjectionRegistry();
  const detach = attachProjectedInputCapture(
    surface as never,
    registry,
    (intent) => {
      sent.push(intent);
    },
    baseOpts({ capturePolicy: 'sparse' }),
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

/** `sparse` must never register `pointermove` and never emit a `move` intent. */
async function testSparsePolicyNeverEmitsMove(): Promise<void> {
  const { doc, surface } = mockSurface();
  const sent: UnifiedIntent[] = [];
  const registry = new PageProjectionRegistry();
  const detach = attachProjectedInputCapture(
    surface as never,
    registry,
    (intent) => {
      sent.push(intent);
    },
    baseOpts({ capturePolicy: 'sparse' }),
  );
  try {
    assert.strictEqual(doc.hasListener('pointermove'), false, 'sparse policy must not register pointermove');
    // Dispatching against a surface with no registered listener is a structural no-op —
    // proves sparse cannot emit `move` even under a synthetic pointermove flood.
    doc.dispatch('pointermove', { clientX: 1, clientY: 1 });
    doc.dispatch('pointermove', { clientX: 2, clientY: 2 });
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(sent.length, 0, 'sparse must never emit a move intent');
    // Other listeners stay intact under sparse — only pointermove is dropped.
    assert.strictEqual(doc.hasListener('pointerdown'), true);
    assert.strictEqual(doc.hasListener('pointerup'), true);
    assert.strictEqual(doc.hasListener('scroll'), true);
    assert.strictEqual(doc.hasListener('keydown'), true);
  } finally {
    detach();
  }
}
