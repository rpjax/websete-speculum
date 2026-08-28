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
  const win = { ...fakeEventTarget(), innerWidth: 800, innerHeight: 600 };
  const doc = {
    ...fakeEventTarget(),
    defaultView: win,
    scrollingElement: null,
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
  await testSparseResolvesNodeIdFromEventTarget();
  await testSparseMissSkipsWhenTargetUnregistered();
  await testEditableKeyPreventDefault();
  await testHistoryShortcutEmitsNavIntent();
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

/** event.target → registry.idOf on down. */
async function testSparseResolvesNodeIdFromEventTarget(): Promise<void> {
  const target = { nodeType: 1 };
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
    doc.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 0, target });
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

/** Unregistered event.target → skip (fail-closed, no null nodeId intent). */
async function testSparseMissSkipsWhenTargetUnregistered(): Promise<void> {
  const target = { nodeType: 1 };
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
  const input = { nodeType: 1, tagName: 'INPUT', isContentEditable: false };
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
  const body = { nodeType: 1, tagName: 'BODY', isContentEditable: false };
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
