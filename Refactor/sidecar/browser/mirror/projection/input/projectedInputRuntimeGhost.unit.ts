import assert from 'assert';
import { ProjectedInputRuntime } from '@speculum/page-projection/projected/input/projectedInputRuntime';
import { PageProjectionRegistry } from '@speculum/page-projection/projected/registry';
import { ScrollableIndex } from '@speculum/page-projection/projected/scroll/scrollableIndex';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';

const INVOKE_IDLE_TIMEOUT_MS = 2000;

function mockDoc() {
  const scrolling = { scrollTop: 0, scrollLeft: 0 };
  return {
    scrollingElement: scrolling,
    defaultView: { scrollX: 0, scrollY: 0 },
  };
}

function depsFor(contextId: number, doc: ReturnType<typeof mockDoc>) {
  return {
    contextId,
    getDocument: () => doc as never,
    getRegistry: () => new PageProjectionRegistry(),
    getScrollIndex: () => new ScrollableIndex(),
  };
}

/** Projected S6 census with registry ghost (ctx id without live bus). */
export async function runProjectedInputRuntimeGhostUnitTests(): Promise<void> {
  const doc = mockDoc();
  const runtime = new ProjectedInputRuntime();
  runtime.bootstrapRoot(depsFor(CONTEXT_ID_ROOT, doc));
  runtime.registerContext(depsFor(2, doc));

  const live = await runtime.requestScrollCensus(CONTEXT_ID_ROOT);
  assert.strictEqual(live.ok, true, 'live root+2 census');

  runtime.unregisterContext(2);
  const ghostRegistry = runtime as unknown as { registry: Set<number> };
  ghostRegistry.registry.add(2);

  const t0 = performance.now();
  const ghost = await runtime.requestScrollCensus(CONTEXT_ID_ROOT);
  const wallMs = performance.now() - t0;

  assert.strictEqual(ghost.ok, false, 'ghost registry must fail census');
  assert.ok(wallMs >= INVOKE_IDLE_TIMEOUT_MS - 50, `timeout wall=${wallMs.toFixed(0)}ms`);
  console.log('[unit] projectedInputRuntime ghost registry census timeout ok');
}
