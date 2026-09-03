/**
 * Projected input capture — sparse-cdp only (event.target → idOf; no pointermove / census).
 */

import assert from 'assert';
import {
  attachProjectedInputCapture,
  type ProjectedInputCaptureOptions,
} from '@speculum/page-projection/projected/input/projectedInputCapture';
import { PageProjectionRegistry } from '@speculum/page-projection/projected/registry';
import { ProjectedInputCaptureMetrics } from '@speculum/page-projection/projected/input/inputCaptureMetrics';
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

function mockSurface() {
  const win: {
    innerWidth: number;
    innerHeight: number;
    document?: unknown;
    addEventListener: (type: string, handler: Handler, _opts?: unknown) => void;
    removeEventListener: (type: string, handler: Handler, _opts?: unknown) => void;
    dispatch: (type: string, event: unknown) => void;
    hasListener: (type: string) => boolean;
  } = { ...fakeEventTarget(), innerWidth: 800, innerHeight: 600 };
  const doc = {
    ...fakeEventTarget(),
    defaultView: win,
    scrollingElement: null,
    documentElement: { clientWidth: 800, clientHeight: 600, style: {} as CSSStyleDeclaration },
    body: { style: {} as CSSStyleDeclaration },
  };
  win.document = doc;
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
  await testSparseResolvesNodeIdFromEventTarget();
  await testSparsePointerCancelEmitsUpAfterDown();
  await testTouchDefersUntilPointerUp();
  await testTouchSlopDiscardsWithoutEmit();
  await testTouchCancelDiscardsWithoutEmit();
  await testTouchScrollSetDiscardsDeferred();
  await testSparseMissSkipsWhenTargetUnregistered();
  await testEditableKeyPreventDefault();
  await testHistoryShortcutEmitsNavIntent();
  await testScrollRangeZeroDoesNotEmit();
  await testScrollEmitsFracWhenRangePositive();
  console.log('[unit] projectedInputCapture sparse ok');
}

/** Sparse must never emit a `move` intent; pointermove is edge-swipe only. */
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
    doc.dispatch('pointermove', { clientX: 10, clientY: 10 });
    doc.dispatch('pointermove', { clientX: 20, clientY: 20 });
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(sent.length, 0, 'sparse must never emit move');
  } finally {
    detach();
  }
}

/** event.target → registry.idOf on down; local % from target rect. */
async function testSparseResolvesNodeIdFromEventTarget(): Promise<void> {
  const target = {
    nodeType: 1,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 }),
  };
  const { doc, surface } = mockSurface();
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
    doc.dispatch('pointerdown', { clientX: 100, clientY: 25, button: 0, target });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0]!.type, 'down');
    if (sent[0]!.type === 'down') {
      assert.strictEqual(sent[0]!.nodeId, 42);
      assert.strictEqual(sent[0]!.x, 100);
      assert.strictEqual(sent[0]!.y, 25);
      assert.strictEqual(sent[0]!.localX, 1);
      assert.strictEqual(sent[0]!.localY, 0.5);
    }
  } finally {
    detach();
  }
}

/** iOS Safari: pointercancel must lift a prior down (same as canvas path) — mouse only. */
async function testSparsePointerCancelEmitsUpAfterDown(): Promise<void> {
  const target = {
    nodeType: 1,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 }),
  };
  const { doc, surface } = mockSurface();
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
    doc.dispatch('pointerdown', { pointerId: 7, clientX: 50, clientY: 25, button: 0, target });
    doc.dispatch('pointercancel', { pointerId: 7, clientX: 50, clientY: 25, button: 0, target });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[0]!.type, 'down');
    assert.strictEqual(sent[1]!.type, 'up');
  } finally {
    detach();
  }
}

function touchTarget() {
  return {
    nodeType: 1,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  };
}

function touchEvent(extra: Record<string, unknown>) {
  return {
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    button: 0,
    ...extra,
  };
}

/** Touch defers down/up until pointerup within slop; geometry frozen from pointerdown. */
async function testTouchDefersUntilPointerUp(): Promise<void> {
  const target = touchTarget();
  const { doc, surface } = mockSurface();
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
    doc.dispatch('pointerdown', touchEvent({
      pointerId: 3,
      pointerType: 'touch',
      clientX: 50,
      clientY: 25,
      target,
    }));
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 0, 'touch down must defer emit');
    doc.dispatch('pointerup', touchEvent({
      pointerId: 3,
      pointerType: 'touch',
      clientX: 52,
      clientY: 27,
      target,
    }));
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[0]!.type, 'down');
    assert.strictEqual(sent[1]!.type, 'up');
    if (sent[0]!.type === 'down' && sent[1]!.type === 'up') {
      assert.strictEqual(sent[0]!.x, 50);
      assert.strictEqual(sent[0]!.y, 25);
      assert.strictEqual(sent[1]!.x, 50);
      assert.strictEqual(sent[1]!.y, 25);
      assert.strictEqual(sent[0]!.nodeId, 42);
      assert.strictEqual(sent[1]!.nodeId, 42);
    }
  } finally {
    detach();
  }
}

/** Touch beyond slop discards deferred tap — no down/up emitted. */
async function testTouchSlopDiscardsWithoutEmit(): Promise<void> {
  const target = touchTarget();
  const { doc, surface } = mockSurface();
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
    doc.dispatch('pointerdown', touchEvent({
      pointerId: 4,
      pointerType: 'touch',
      clientX: 50,
      clientY: 25,
      target,
    }));
    doc.dispatch('pointermove', touchEvent({
      pointerId: 4,
      pointerType: 'touch',
      clientX: 50,
      clientY: 40,
      target,
    }));
    doc.dispatch('pointerup', touchEvent({
      pointerId: 4,
      pointerType: 'touch',
      clientX: 50,
      clientY: 40,
      target,
    }));
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 0, 'touch beyond slop must emit nothing');
  } finally {
    detach();
  }
}

/** Touch pointercancel discards deferred — no finishPendingPointer orphan up. */
async function testTouchCancelDiscardsWithoutEmit(): Promise<void> {
  const target = touchTarget();
  const { doc, surface } = mockSurface();
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
    doc.dispatch('pointerdown', touchEvent({
      pointerId: 5,
      pointerType: 'touch',
      clientX: 50,
      clientY: 25,
      target,
    }));
    doc.dispatch('pointercancel', touchEvent({
      pointerId: 5,
      pointerType: 'touch',
      clientX: 50,
      clientY: 25,
      target,
    }));
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 0, 'touch cancel must discard deferred');
  } finally {
    detach();
  }
}

/** scrollSet about to enqueue discards deferred touch — pointerup emits nothing. */
async function testTouchScrollSetDiscardsDeferred(): Promise<void> {
  const target = touchTarget();
  const { win, doc, surface } = mockSurface();
  const se = {
    scrollTop: 100,
    scrollLeft: 0,
    scrollHeight: 600 + 500,
    clientHeight: 600,
    scrollWidth: 800,
    clientWidth: 800,
  };
  (doc as { scrollingElement: unknown }).scrollingElement = se;
  Object.assign(win, { scrollY: 100, scrollX: 0 });
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
    doc.dispatch('pointerdown', touchEvent({
      pointerId: 6,
      pointerType: 'touch',
      clientX: 50,
      clientY: 25,
      target,
    }));
    doc.dispatch('scroll', { target: doc });
    doc.dispatch('pointerup', touchEvent({
      pointerId: 6,
      pointerType: 'touch',
      clientX: 50,
      clientY: 25,
      target,
    }));
    await new Promise((r) => setTimeout(r, 120));
    const downs = sent.filter((i) => i.type === 'down');
    const ups = sent.filter((i) => i.type === 'up');
    assert.strictEqual(downs.length, 0, 'scroll must discard deferred down');
    assert.strictEqual(ups.length, 0, 'scroll must discard deferred up');
    assert.ok(sent.some((i) => i.type === 'scrollSet'), 'scrollSet must still emit');
  } finally {
    detach();
  }
}

/** Unregistered event.target → skip (fail-closed, no null nodeId intent). */
async function testSparseMissSkipsWhenTargetUnregistered(): Promise<void> {
  const target = { nodeType: 1, closest: () => null };
  const { doc, surface } = mockSurface();
  const sent: UnifiedIntent[] = [];
  const metrics = new ProjectedInputCaptureMetrics();
  const registry = new PageProjectionRegistry();
  const detach = attachProjectedInputCapture(
    surface as never,
    registry,
    (intent) => {
      sent.push(intent);
    },
    baseOpts({ metrics }),
  );
  try {
    doc.dispatch('pointerup', { clientX: 1, clientY: 2, button: 0, target });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 0, 'unregistered target must not enqueue');
    assert.strictEqual(metrics.snapshot().skippedNoNodeId, 1);
  } finally {
    detach();
  }
}

/** Editable target keys are forwarded and default action blocked (Virtual is source of truth). */
async function testEditableKeyPreventDefault(): Promise<void> {
  const input = { nodeType: 1, tagName: 'INPUT', isContentEditable: false, closest: () => null };
  const { doc, surface } = mockSurface();
  const sent: UnifiedIntent[] = [];
  let prevented = false;
  const registry = new PageProjectionRegistry();
  registry.register(7, input as never);
  const detach = attachProjectedInputCapture(
    surface as never,
    registry,
    (intent) => {
      sent.push(intent);
    },
    baseOpts(),
  );
  try {
    doc.dispatch('keydown', {
      target: input,
      key: 'a',
      code: 'KeyA',
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => undefined,
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(prevented, 'editable keydown must preventDefault');
    assert.strictEqual(sent.length, 1);
    if (sent[0]!.type === 'keyDown') {
      assert.strictEqual(sent[0]!.key, 'a');
    }
  } finally {
    detach();
  }
}

/** Alt+Arrow history shortcuts → historyNav intent, default blocked. */
async function testHistoryShortcutEmitsNavIntent(): Promise<void> {
  const body = { nodeType: 1, tagName: 'BODY', isContentEditable: false, closest: () => null };
  const { doc, surface } = mockSurface();
  const sent: UnifiedIntent[] = [];
  let prevented = false;
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
    doc.dispatch('keydown', {
      target: body,
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      altKey: true,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => undefined,
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(prevented, 'history shortcut must preventDefault');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0]!.type, 'historyNav');
    if (sent[0]!.type === 'historyNav') {
      assert.strictEqual(sent[0]!.direction, 'back');
    }
  } finally {
    detach();
  }
}

/** Range zero (no overflow) → no scrollSet intent. */
async function testScrollRangeZeroDoesNotEmit(): Promise<void> {
  const { win, doc, surface } = mockSurface();
  const se = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 600,
    clientHeight: 600,
    scrollWidth: 800,
    clientWidth: 800,
  };
  (doc as { scrollingElement: unknown }).scrollingElement = se;
  Object.assign(win, { scrollY: 0, scrollX: 0 });
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
    doc.dispatch('scroll', { target: doc });
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(sent.length, 0, 'range zero must not emit scrollSet');
  } finally {
    detach();
  }
}

/** Positive range → scrollFracY = scrollTop / range. */
async function testScrollEmitsFracWhenRangePositive(): Promise<void> {
  const { win, doc, surface } = mockSurface();
  const se = {
    scrollTop: 3757,
    scrollLeft: 0,
    scrollHeight: 600 + 6696,
    clientHeight: 600,
    scrollWidth: 800,
    clientWidth: 800,
  };
  (doc as { scrollingElement: unknown }).scrollingElement = se;
  Object.assign(win, { scrollY: 3757, scrollX: 0 });
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
    doc.dispatch('scroll', { target: doc });
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0]!.type, 'scrollSet');
    if (sent[0]!.type === 'scrollSet') {
      assert.strictEqual(sent[0]!.scrollFracY, 3757 / 6696);
      assert.strictEqual(sent[0]!.scrollFracX, 0);
      assert.strictEqual(sent[0]!.nodeId, null);
    }
  } finally {
    detach();
  }
}
