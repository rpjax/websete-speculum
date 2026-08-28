/**
 * Virtual-side PageProjection bootstrap — sole esbuild entry for Isolated World.
 * Composition root: constructs planes, pipe, and algorithm use cases (resync / snapshot).
 * Cold start: {@link rebuildAndResync} after `observe()` (§5.1 / §5.8).
 */

import type { FrameClock } from './clock/frameClock';
import { TimerFrameClock } from './clock/timerFrameClock';
import { readProjectionConfig } from './config/projectionConfig';
import { MutationBuffer } from './dom/mutationBuffer';
import { DomMutationObserver } from './dom/domMutationObserver';
import { DomNodeTable } from './dom/domNodeTable';
import { DOCUMENT_ID, CONTEXT_ID_ROOT } from '../core/frame';
import { CONTEXT_ID_PROVISIONAL } from '../core/contextBusConstants';
import { OpCode } from '../core/opcodes';
import { ReplicatedTable } from '../core/replicatedTable';
import { BinaryFrameEncoder } from './frame/binaryFrameEncoder';
import { FrameEmitter } from './frame/frameEmitter';
import { emitResyncFrame, rebuildAndResync, type ResyncPlanes } from './resync';
import { snapshotTree } from '../core/snapshot/domTreeSnapshot';
import { takeSnapshot } from './snapshot';
import { TableFrameBuilder } from './dom/tableFrameBuilder';
import { FormPropIndex } from './dom/formPropIndex';
import { CssomIds } from './cssom/cssomIds';
import { CssomPoller } from './cssom/cssomPoller';
import { CssomIdleScheduler } from './cssom/cssomIdleScheduler';
import { disabledCssomPlane, type CssomPlane } from './cssom/cssomPlane';
import { ProjectionTelemetry } from './telemetry/projectionTelemetry';
import type { FrameTransport } from './transport/frameTransport';
import { LoopbackFrameTransport } from './transport/loopbackFrameTransport';
import { BusFrameTransport } from './transport/busFrameTransport';
import { VirtualDomainBus } from './bus/virtualDomainBus';
import { RootRuntime } from './runtime/rootRuntime';
import { ContextRegistry } from './runtime/contextRegistry';
import { ChildScopeIndex, createMintPort } from './dom/childScopes';
import type { TableLiveOracleResult } from '../core/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '../core/cssomTableLiveOracle';
import { compareTableToLiveDom } from './dom/tableLiveOracle';
import { PlaneChannel, type DataPlane } from '../core/plane';
import type { CssomPollStats } from './cssom/cssomPoller';
import { applyScrollPositions } from './input/applyScrollPositions';
import { NONE_DOM_NODE_KEY } from '../core/domNodeKey';

declare global {
  var __speculumProjection:
    | {
        readonly version: 1;
        readonly domNodes: DomNodeTable;
        readonly table: ReplicatedTable;
        readonly frameClock: FrameClock;
        readonly mutationBuffer: MutationBuffer;
        readonly domMutationObserver: DomMutationObserver;
        readonly frameBuilder: TableFrameBuilder;
        readonly frameEmitter: FrameEmitter;
        readonly frameTransport: FrameTransport;
        readonly telemetry: ProjectionTelemetry;
        readonly compareTableToLiveDom: () => TableLiveOracleResult;
        haltWorld: () => void;
        resumeWorld: () => void;
        readonly cssomPoller: CssomPoller | null;
        flushFrame: () => { generation: number; sequence: number };
        /**
         * One JS turn: drain MO buffer → emit frame → O2. DOM cannot mutate mid-call
         * (run-to-completion). Stops the frame clock afterwards so no sequence S+1
         * races the client applying S. Caller must resumeWorld().
         * Snapshot CSSOM default is `none` (halt idle). Pass `{ cssom: 'scan' | 'committed' }` to include.
         */
        flushAndSnapshot: (opts?: { cssom?: 'none' | 'committed' | 'scan' }) => {
          generation: number;
          sequence: number;
          o2: TableLiveOracleResult;
          table: { rowCount: number; tableHash: string };
          cssom: CssomPollStats | null;
          cssomO2: CssomTableLiveOracleResult | null;
          nodeNewConnected: {
            ok: boolean;
            checked: number;
            disconnectedIds: number[];
          };
          cascade: {
            authorColor: string;
            adoptedColor: string;
            adoptedCount: number;
            styleSheetCount: number;
            styleElCount: number;
            doublePaint: boolean;
          } | null;
        };
        readonly contextId: number;
        snapshotContext: (
          contextId: number,
          opts?: { cssom?: 'none' | 'committed' | 'scan'; includeTree?: boolean },
        ) => Promise<
          | { ok: true; value: import('./bus/virtualDomainBus').SnapshotRpcPayload }
          | { ok: false; reason: string }
        >;
        snapshotAllKnown: (
          contextIds: number[],
          opts?: { cssom?: 'none' | 'committed' | 'scan'; includeTree?: boolean },
        ) => Promise<Record<number, import('./bus/virtualDomainBus').SnapshotRpcPayload | { ok: false; reason: string }>>;
        resumeContext: (contextId: number) => Promise<{ ok: boolean; reason?: string }>;
        resumeAllKnown: (contextIds: number[]) => Promise<Record<number, { ok: boolean; reason?: string }>>;
        applyScrollSet: (args: {
          contextId: number;
          nodeId: number | null;
          scrollX: number;
          scrollY: number;
        }) => Promise<{ ok: boolean; reason?: string }>;
        keyOfSelector: (args: {
          selector: string;
          contextId?: number;
        }) => Promise<{ ok: boolean; nodeId?: number; reason?: string }>;
        resolveElementHit: (args: {
          selector: string;
          contextId?: number;
        }) => Promise<{
          ok: boolean;
          x?: number;
          y?: number;
          scrollX?: number;
          scrollY?: number;
          nodeId?: number | null;
          reason?: string;
        }>;
        /**
         * Sparse-cdp path — validates client pointer coords against live node bounds and
         * returns the root-viewport point for CDP dispatch (not element center).
         */
        resolveNodeHit: (args: {
          nodeId: number;
          contextId?: number;
          x?: number;
          y?: number;
        }) => Promise<{ ok: boolean; x?: number; y?: number; reason?: string }>;
      }
    | undefined;
}

function scrubSpeculumInjectScripts(): void {
  const cur = document.currentScript;
  const marker = '__SPECULUM_PP_INJECT_V1__';
  const list = document.querySelectorAll('script');
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s === cur) continue;
    if (!s.src && s.textContent?.includes(marker)) s.remove();
  }
}

scrubSpeculumInjectScripts();
document.currentScript?.remove();

void (async () => {
  if (globalThis.__speculumProjection) return;
  const bootGlobal = globalThis as { __speculumProjectionBoot?: Promise<void> };
  if (bootGlobal.__speculumProjectionBoot) {
    await bootGlobal.__speculumProjectionBoot;
    return;
  }

  bootGlobal.__speculumProjectionBoot = (async () => {
  try {
  const config = readProjectionConfig();
  const isRoot = window.parent === window;
  let mine = CONTEXT_ID_ROOT;
  let frameTransport: FrameTransport;
  let dataPlane: DataPlane | null = null;
  let loopback: LoopbackFrameTransport | null = null;
  let bus: VirtualDomainBus;
  let mintFn: () => number | null;

  if (isRoot) {
    const runtime = new RootRuntime(config, window);
    loopback = runtime.loopback;
    frameTransport = runtime.frameTransport;
    dataPlane = runtime.dataPlane;
    bus = runtime.bus;
    mintFn = () => runtime.mint();
    mine = CONTEXT_ID_ROOT;
    try {
      await runtime.establishConnection();
    } catch (err) {
      throw new Error(
        `[speculumProjection] data plane establish failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    // Provisional bus id — must not collide with CONTEXT_ID_ROOT (1) while getScopeId pending.
    bus = new VirtualDomainBus({
      window,
      parent: window.parent,
      role: 'nested',
      contextId: CONTEXT_ID_PROVISIONAL,
    });
    frameTransport = new BusFrameTransport(bus);
    mintFn = createMintPort({ requestMint: () => bus.requestMint() });
    while (true) {
      try {
        const parentReady = (window.parent as { __speculumProjection?: { contextId?: number } })
          .__speculumProjection?.contextId === CONTEXT_ID_ROOT;
        if (parentReady) break;
      } catch {
        /* cross-origin parent */
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    mine = await bus.getScopeId();
  }

  const childScopes = new ChildScopeIndex(mintFn);

  const domNodes = new DomNodeTable();
  const nodeOf = (id: number) => domNodes.get(id);
  bus.setScopeLookup((source) => childScopes.lookupByContentWindow(source, nodeOf));
  bus.setChildFabric({
    windowOf: (contextId) => childScopes.windowOf(contextId, nodeOf),
    forEachLive: (fn) => childScopes.forEachLiveWindow(nodeOf, fn),
  });
  // Live index only — never mint-ever (hasMinted). Root always deliverable; children need live contentWindow.
  bus.setDeliverableCheck((contextId) => {
    if (contextId === CONTEXT_ID_ROOT) return true;
    return childScopes.windowOf(contextId, nodeOf) != null;
  });
  domNodes.bind(document, DOCUMENT_ID);
  domNodes.setGeneration(config.generation);
  const table = new ReplicatedTable();
  const formIndex = new FormPropIndex();

  const mutationBuffer = new MutationBuffer();
  const domMutationObserver = new DomMutationObserver({ buffer: mutationBuffer });
  const frameBuilder = new TableFrameBuilder({
    domNodes,
    table,
    formIndex,
    childScopes,
    observeShadowRoot: (root) => domMutationObserver.observeRoot(root),
    unobserveShadowRoot: (root) => domMutationObserver.unobserveRoot(root),
  });
  const encoder = new BinaryFrameEncoder({ maxFrameBytes: config.maxFrameBytes });

  const telemetry = new ProjectionTelemetry({
    config: config.telemetry,
    dataPlane,
    contextId: mine,
    bus,
  });

  const cssomPoller =
    config.cssomPollHz > 0
      ? new CssomPoller(new CssomIds(() => domNodes.mint()), (host) => {
          const id = domNodes.keyOf(host);
          return id;
        })
      : null;
  const cssom: CssomPlane =
    cssomPoller !== null
      ? new CssomIdleScheduler({
          poller: cssomPoller,
          minIntervalMs: 1000 / config.cssomPollHz,
        })
      : disabledCssomPlane();

  const resyncPlanes: ResyncPlanes = {
    domNodes,
    table,
    cssom,
    formIndex,
    childScopes,
    contextId: mine,
    notePendingNestedHost: (el) => frameBuilder.notePendingNestedHost(el),
  };

  const frameClock: FrameClock = new TimerFrameClock({
    frameRateHz: config.frameRateHz,
    onStall: (info) => {
      telemetry.recordClockStalled({
        sinceLastTickMs: info.sinceLastTickMs,
        rateHz: frameClock.rateHz,
      });
    },
    onRateChanged: (info) => telemetry.recordRateChanged(info),
  });

  domMutationObserver.start();

  const frameEmitter = new FrameEmitter({
    clock: frameClock,
    buffer: mutationBuffer,
    builder: frameBuilder,
    encoder,
    transport: frameTransport,
    census: () => ({
      generation: domNodes.generation,
      tableSize: table.size,
      identitySize: domNodes.size,
    }),
    telemetry,
    pullPendingMutations: () => domMutationObserver.takePendingIntoBuffer(),
    takePendingCssom: () => cssom.takePending(),
    table,
    contextId: mine,
  });

  bus.setMine(mine);

  const contextRegistry = isRoot ? new ContextRegistry(bus) : null;
  if (contextRegistry && isRoot) {
    contextRegistry.announceRootOnline(mine);
  }

  const snapshotPlanes = {
    domNodes,
    table,
    cssom,
    cssomIds: cssomPoller?.ids ?? null,
    currentSequence: () => frameEmitter.currentSequence,
    flushDom: () => frameEmitter.flushNow(),
    recordCssomPoll: (stats: import('../core/telemetry').CssomPollStats) => telemetry.recordCssomPoll(stats),
  };

  bus.setSnapshotHandler((opts) => {
    const snapped = takeSnapshot(snapshotPlanes, { cssom: opts?.cssom ?? 'none' });
    frameEmitter.stop();
    cssom.halt();
    return snapped;
  });

  bus.setResumeHandler(() => {
    frameEmitter.start();
    cssom.start();
    domMutationObserver.syncObservedShadowRoots(domNodes);
  });

  bus.setApplyScrollHandler((positions) => applyScrollPositions(domNodes, document, positions));

  function rootViewportFrameOffset(): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    let walk: Window | null = document.defaultView;
    while (walk && walk !== walk.top) {
      let frameEl: Element | null = null;
      try {
        frameEl = walk.frameElement;
      } catch {
        break;
      }
      if (!frameEl) break;
      const fr = frameEl.getBoundingClientRect();
      dx += fr.left;
      dy += fr.top;
      try {
        walk = walk.parent;
      } catch {
        break;
      }
    }
    return { dx, dy };
  }

  function clientPointInRootViewport(el: Element): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    const { dx, dy } = rootViewportFrameOffset();
    return { x: rect.left + rect.width / 2 + dx, y: rect.top + rect.height / 2 + dy };
  }

  function elementRectInRootViewport(el: Element): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const rect = el.getBoundingClientRect();
    const { dx, dy } = rootViewportFrameOffset();
    return {
      left: rect.left + dx,
      top: rect.top + dy,
      right: rect.right + dx,
      bottom: rect.bottom + dy,
    };
  }

  function pointInsideRect(
    x: number,
    y: number,
    rect: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  bus.onInvocation('keyOfSelector', (args: { selector: string }) => {
    // Drain this context's MO → identity before lookup (nested flush ≠ root flushFrame).
    frameEmitter.flushNow();
    const el = document.querySelector(args.selector);
    if (!el) return { ok: false as const, reason: 'selector_miss' };
    const nodeId = domNodes.keyOf(el);
    if (nodeId === NONE_DOM_NODE_KEY) return { ok: false as const, reason: 'node_unmapped' };
    return { ok: true as const, nodeId };
  });

  bus.onInvocation('resolveElementHit', (args: { selector: string }) => {
    frameEmitter.flushNow();
    const el = document.querySelector(args.selector);
    if (!el) return { ok: false as const, reason: 'selector_miss' };
    const { x, y } = clientPointInRootViewport(el);
    const win = document.defaultView;
    const scrollX = win?.scrollX || document.scrollingElement?.scrollLeft || 0;
    const scrollY = win?.scrollY || document.scrollingElement?.scrollTop || 0;
    const nodeIdRaw = domNodes.keyOf(el);
    const nodeId = nodeIdRaw === NONE_DOM_NODE_KEY ? null : nodeIdRaw;
    return { ok: true as const, x, y, scrollX, scrollY, nodeId };
  });

  bus.onInvocation('resolveNodeHit', (args: { nodeId: number; x?: number; y?: number }) => {
    frameEmitter.flushNow();
    const node = domNodes.get(args.nodeId);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return { ok: false as const, reason: 'node_not_found' };
    }
    const el = node as Element;
    if (typeof args.x === 'number' && typeof args.y === 'number') {
      const rect = elementRectInRootViewport(el);
      if (!pointInsideRect(args.x, args.y, rect)) {
        return { ok: false as const, reason: 'point_outside_node' };
      }
      return { ok: true as const, x: args.x, y: args.y };
    }
    const { x, y } = clientPointInRootViewport(el);
    return { ok: true as const, x, y };
  });

  bus.onResyncRequest((req) => {
    if (req.contextId !== mine) return;
    frameEmitter.requestResync((seq) => {
      const { frame, cssom: cssomStats } = emitResyncFrame(resyncPlanes, seq);
      telemetry.recordCssomPoll(cssomStats);
      return frame;
    });
  });

  if (dataPlane) {
    dataPlane.setHandler((channel, payload) => {
      if (channel !== PlaneChannel.Control) return;
      let msg: unknown;
      try {
        msg = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null) return;
      const req = msg as {
        type?: unknown;
        reason?: unknown;
        generation?: unknown;
        sequence?: unknown;
        contextId?: unknown;
      };
      const contextId =
        typeof req.contextId === 'number' && req.contextId > 0 ? req.contextId : CONTEXT_ID_ROOT;

      if (req.type !== 'requestResync') return;
      console.log(
        '[speculumProjection] resync requested — reason=%s contextId=%s clientGeneration=%s clientSequence=%s',
        String(req.reason),
        String(contextId),
        String(req.generation),
        String(req.sequence),
      );
      // Sole resync entry: PlaneChannel.Control → publishResyncRequest (lab, Sessions, runner).
      bus.publishResyncRequest({
        contextId,
        reason: typeof req.reason === 'string' ? req.reason : undefined,
        generation: typeof req.generation === 'number' ? req.generation : undefined,
        sequence: typeof req.sequence === 'number' ? req.sequence : undefined,
      });
    });
  }

  const { frame: resyncFrame, cssom: cssomResyncStats } = rebuildAndResync(
    resyncPlanes,
    frameEmitter.currentSequence + 1,
  );
  telemetry.recordCssomPoll(cssomResyncStats);
  if (config.generation > 1) {
    resyncFrame.ops.unshift({ op: OpCode.EpochReset, generation: config.generation });
  }
  domMutationObserver.takePendingIntoBuffer();
  mutationBuffer.drain();
  await frameEmitter.sendInitial(resyncFrame);
  domMutationObserver.syncObservedShadowRoots(domNodes);

  frameEmitter.start();
  telemetry.start();
  cssom.start();

  // Each producer context (root + nested) exposes tree capture for bus snapshot RPC (`includeTree`).
  (globalThis as { __speculumSnapshot?: { snapshotTree: typeof snapshotTree } }).__speculumSnapshot = {
    snapshotTree,
  };

  globalThis.__speculumProjection = {
    version: 1,
    contextId: mine,
    domNodes,
    table,
    frameClock,
    mutationBuffer,
    domMutationObserver,
    frameBuilder,
    frameEmitter,
    frameTransport,
    telemetry,
    cssomPoller,
    compareTableToLiveDom: () => compareTableToLiveDom(table, domNodes, document),
    haltWorld: () => {
      frameEmitter.stop();
      cssom.halt();
      domMutationObserver.unobserveAllRoots();
    },
    resumeWorld: () => {
      frameEmitter.start();
      cssom.start();
      domMutationObserver.syncObservedShadowRoots(domNodes);
    },
    flushFrame: () => {
      frameEmitter.flushNow();
      return { generation: domNodes.generation, sequence: frameEmitter.currentSequence };
    },
    flushAndSnapshot: (opts) => {
      const snapped = takeSnapshot(snapshotPlanes, { cssom: opts?.cssom ?? 'none' });
      frameEmitter.stop();
      cssom.halt();
      return snapped;
    },
    snapshotContext: (contextId, opts) => bus.requestSnapshot(contextId, opts),
    snapshotAllKnown: async (contextIds, opts) => {
      const entries = await Promise.all(
        contextIds.map(async (id) => {
          const result = await bus.requestSnapshot(id, opts);
          return [id, result.ok ? result.value : { ok: false as const, reason: result.reason }] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    resumeContext: (contextId) => bus.requestResumeContext(contextId),
    resumeAllKnown: async (contextIds) => {
      const entries = await Promise.all(
        contextIds.map(async (id) => [id, await bus.requestResumeContext(id)] as const),
      );
      return Object.fromEntries(entries);
    },
    applyScrollSet: async (args) => {
      const r = await bus.requestApplyScroll(args.contextId, [
        { nodeId: args.nodeId, scrollX: args.scrollX, scrollY: args.scrollY },
      ]);
      if (!r.ok) return { ok: false, reason: r.reason ?? 'apply_scroll_failed' };
      return { ok: true };
    },
    keyOfSelector: async (args) => {
      const contextId =
        typeof args.contextId === 'number' && args.contextId > 0 ? args.contextId : CONTEXT_ID_ROOT;
      return bus.requestKeyOfSelector(contextId, args.selector);
    },
    resolveElementHit: async (args) => {
      const contextId =
        typeof args.contextId === 'number' && args.contextId > 0 ? args.contextId : CONTEXT_ID_ROOT;
      return bus.requestResolveElementHit(contextId, args.selector);
    },
    resolveNodeHit: async (args) => {
      const contextId =
        typeof args.contextId === 'number' && args.contextId > 0 ? args.contextId : CONTEXT_ID_ROOT;
      return bus.requestResolveNodeHit(contextId, args.nodeId, args.x, args.y);
    },
  };

  if (dataPlane) {
    dataPlane.setInvokeHandler(async (name, args) => {
      const p = globalThis.__speculumProjection;
      if (!p) throw new Error('producer missing');
      switch (name) {
        case 'applyScrollSet': {
          const a = args as {
            contextId: number;
            nodeId: number | null;
            scrollX: number;
            scrollY: number;
          };
          return p.applyScrollSet(a);
        }
        case 'keyOfSelector': {
          const a = (args ?? {}) as { selector?: string; contextId?: number };
          if (typeof a.selector !== 'string' || !a.selector) {
            throw new Error('keyOfSelector: missing selector');
          }
          return p.keyOfSelector({ selector: a.selector, contextId: a.contextId });
        }
        case 'resolveElementHit': {
          const a = (args ?? {}) as { selector?: string; contextId?: number };
          if (typeof a.selector !== 'string' || !a.selector) {
            throw new Error('resolveElementHit: missing selector');
          }
          return p.resolveElementHit({ selector: a.selector, contextId: a.contextId });
        }
        case 'resolveNodeHit': {
          const a = (args ?? {}) as { nodeId?: number; contextId?: number; x?: number; y?: number };
          if (typeof a.nodeId !== 'number') {
            throw new Error('resolveNodeHit: missing nodeId');
          }
          return p.resolveNodeHit({ nodeId: a.nodeId, contextId: a.contextId, x: a.x, y: a.y });
        }
        case 'haltWorld':
          p.haltWorld();
          return { ok: true };
        case 'resumeWorld':
          p.resumeWorld();
          return { ok: true };
        case 'flushFrame': {
          const r = p.flushFrame();
          return { ok: true, generation: r.generation, sequence: r.sequence };
        }
        case 'snapshotContext': {
          const a = (args ?? {}) as {
            contextId?: number;
            includeTree?: boolean;
            cssom?: 'none' | 'committed' | 'scan';
          };
          const contextId =
            typeof a.contextId === 'number' && a.contextId > 0 ? a.contextId : CONTEXT_ID_ROOT;
          return p.snapshotContext(contextId, {
            includeTree: a.includeTree,
            cssom: a.cssom,
          });
        }
        default:
          throw new Error(`unknown loopback invoke: ${name}`);
      }
    });
  }
  } catch (err) {
    console.error('[speculumProjection] bootstrap failed', err);
    throw err;
  }
  })();

  await bootGlobal.__speculumProjectionBoot;
})();
