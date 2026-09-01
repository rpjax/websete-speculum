/**
 * Virtual-side PageProjection bootstrap — sole esbuild entry for Isolated World.
 * Composition root: constructs planes, pipe, and algorithm use cases (resync / snapshot).
 * Cold start: {@link rebuildAndResync} after `observe()` (§5.1 / §5.8).
 */

import type { FrameClock } from './clock/frameClock';
import { TimerFrameClock } from './clock/timerFrameClock';
import { awaitProjectionConfig } from './config/projectionConfig';
import { MutationBuffer } from './dom/mutationBuffer';
import { DomMutationObserver } from './dom/domMutationObserver';
import { DomNodeTable } from './dom/domNodeTable';
import { DOCUMENT_ID, CONTEXT_ID_ROOT } from '../core/frame';
import { CONTEXT_ID_PROVISIONAL } from '../core/contextBusConstants';
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
import { beginBootDiag, bootDiagLog, mintBootDiagId, setBootOutcome } from './bootDiag';
import { BusFrameTransport } from './transport/busFrameTransport';
import { VirtualDomainBus } from './bus/virtualDomainBus';
import { RootRuntime } from './runtime/rootRuntime';
import { ContextRegistry } from './runtime/contextRegistry';
import {
  initNestedContext,
  initRootContext,
  resolveRootUpwardPeer,
  NESTED_INIT_CONTEXT_TIMEOUT_MS,
  ROOT_INIT_CONTEXT_TIMEOUT_MS,
  type ContextIdentity,
} from './runtime/initContext';
import { ChildScopeIndex, createMintPort, type MintPort } from './dom/childScopes';
import type { TableLiveOracleResult } from '../core/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '../core/cssomTableLiveOracle';
import { compareTableToLiveDom } from './dom/tableLiveOracle';
import { PlaneChannel, type DataPlane } from '../core/plane';
import { mapLocalHitToRootPoint } from '../core/input/localHit';
import {
  elementLocalViewportRect,
  iframeContentBoxOrigin,
  mapPointAcrossHop,
  type ViewportHop,
} from '../core/input/viewportChain';
import { ContextLineageIndex } from './dom/contextLineage';
import type { CssomPollStats } from './cssom/cssomPoller';
import { applyScrollPositions } from './input/applyScrollPositions';
import { NONE_DOM_NODE_KEY } from '../core/domNodeKey';
import { installClosedShadowCapture } from './dom/closedShadowCapture';
import { resolveShadowRoot } from '../core/closedShadowLookup';

installClosedShadowCapture();

/**
 * Nested cold seed: wait until the document is past `loading`, then two rAFs so
 * sync parser-injected nodes exist before {@link rebuildAndResync}. Without this,
 * childList under not-yet-mapped parents is dropped and live elements stay
 * `node_unmapped` for lab `keyOfSelector` (input-iframe-click).
 */
function waitDocumentSeedReady(doc: Document): Promise<void> {
  const afterPaint = (): Promise<void> =>
    new Promise((resolve) => {
      const raf = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView);
      if (!raf) {
        setTimeout(resolve, 0);
        return;
      }
      raf(() => raf(() => resolve()));
    });

  if (doc.readyState !== 'loading') return afterPaint();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      void afterPaint().then(resolve);
    };
    doc.addEventListener('DOMContentLoaded', finish, { once: true });
    doc.addEventListener('readystatechange', () => {
      if (doc.readyState !== 'loading') finish();
    });
    setTimeout(finish, 5_000);
  });
}

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
         * Sparse-cdp — map localX/localY ([0,1] in node box) to live root-viewport CSS for CDP.
         * Omit local → element center (lab). Absolute x/y are not a hit criterion.
         */
        resolveNodeHit: (args: {
          nodeId: number;
          contextId?: number;
          localX?: number;
          localY?: number;
          x?: number;
          y?: number;
        }) => Promise<{ ok: boolean; x?: number; y?: number; reason?: string }>;
        measureNodeRect: (args: {
          nodeId: number;
          contextId?: number;
        }) => Promise<{
          ok: boolean;
          reason?: string;
          tagName?: string;
          rect?: { x: number; y: number; width: number; height: number };
          offsetWidth?: number;
          offsetHeight?: number;
          display?: string | null;
          visibility?: string | null;
          hasSrcAttr?: boolean;
          src?: string | null;
        }>;
        measureNodePaint: (args: {
          nodeId: number;
          contextId?: number;
        }) => Promise<{
          ok: boolean;
          reason?: string;
          paint?: {
            backgroundColor: string;
            color: string;
            opacity: string;
            visibility: string;
            display: string;
            borderTopWidth: string;
            borderTopColor: string;
            borderTopStyle: string;
            width: string;
            height: string;
          };
        }>;
        measureTurnstileRootRects: () => Promise<{
          ok: boolean;
          levels?: Array<{
            name: string;
            ok: boolean;
            reason?: string;
            tagName?: string;
            rect?: { x: number; y: number; width: number; height: number };
            offsetWidth?: number;
            offsetHeight?: number;
            display?: string | null;
            visibility?: string | null;
            hasSrcAttr?: boolean | null;
            src?: string | null;
          }>;
        }>;
        evaluateInContext: (args: {
          contextId?: number;
          expression: string;
        }) => Promise<{ ok: boolean; value?: unknown; reason?: string }>;
        listChildScopeHosts: () => Promise<{
          ok: boolean;
          reason?: string;
          generation: number;
          hosts: Array<{
            contextId: number;
            hostNodeId: number;
            domId: string | null;
            src: string;
            w: number;
            h: number;
            isConnected: boolean;
          }>;
        }>;
      }
    | undefined;
}

/**
 * Boot order (runtime-redesign.md §5): `config gate → observer + bus listeners → await
 * initContext() → activate`.
 *
 * No re-entrancy guard and no script scrubbing: this bundle runs once per document install, in a
 * fresh JS realm, delivered by the content script. The old `__speculumProjectionBoot` promise and
 * `scrubSpeculumInjectScripts()` existed to survive double injection through the page's own DOM,
 * which is not how the runtime arrives any more (§10 deletion inventory). A second boot in one
 * realm would now be a delivery bug and must be visible, not silently absorbed.
 */
void (async () => {
  const bootId = mintBootDiagId();
  beginBootDiag(bootId);
  bootDiagLog('boot_start', { action: 'start' });

  try {
  // 1. Config gate — fail closed before anything observes or emits.
  const isRoot = window.parent === window;
  const config = await awaitProjectionConfig({ role: isRoot ? 'root' : 'nested' });
  if (config === null) {
    setBootOutcome('config_gate_timeout');
    bootDiagLog('boot_dormant', { reason: 'config_gate_timeout' });
    return;
  }
  const launchTiming = (globalThis as { __SPECULUM_LAUNCH_TIMING__?: Record<string, unknown> })
    .__SPECULUM_LAUNCH_TIMING__;
  const configGateTiming = launchTiming?.configGate as
    | { durationMs?: number; attempts?: number; ok?: boolean }
    | undefined;
  if (configGateTiming?.durationMs !== undefined) {
    bootDiagLog('config_gate_ok', {
      durationMs: configGateTiming.durationMs,
      attempts: configGateTiming.attempts ?? null,
    });
  }
  let frameTransport: FrameTransport;
  let dataPlane: DataPlane | null = null;
  let loopback: LoopbackFrameTransport | null = null;
  let bus: VirtualDomainBus;
  let mintFn: MintPort;
  let rootRuntime: RootRuntime | null = null;

  if (isRoot) {
    // Do NOT establish the data plane yet: the hello has to carry the generation that
    // `initContext` is about to state, not one predicted before this document existed (§6).
    rootRuntime = new RootRuntime(config, window);
    loopback = rootRuntime.loopback;
    frameTransport = rootRuntime.frameTransport;
    dataPlane = rootRuntime.dataPlane;
    bus = rootRuntime.bus;
    const mintRoot = rootRuntime;
    mintFn = createMintPort({ mintSync: () => mintRoot.mint() });
  } else {
    // Provisional bus id — must not collide with CONTEXT_ID_ROOT (1) until initContext answers.
    bus = new VirtualDomainBus({
      window,
      parent: window.parent,
      role: 'nested',
      contextId: CONTEXT_ID_PROVISIONAL,
    });
    frameTransport = new BusFrameTransport(bus);
    mintFn = createMintPort({ requestMint: () => bus.requestMint() });
  }

  const lineage = isRoot ? new ContextLineageIndex() : null;

  const childScopes = new ChildScopeIndex(mintFn, {
    // A queued child `initContext` becomes answerable the instant its host row is admitted.
    onAdmit: (childContextId, hostNodeId) => {
      bus.noteChildScopeChanged();
      const parentContextId = bus.contextId;
      if (lineage) {
        lineage.register(childContextId, parentContextId);
      } else {
        void bus.requestRegisterScopeLineage(childContextId, parentContextId);
      }
      if (isRoot) {
        const deliverable = childScopes.windowOf(childContextId, nodeOf) != null;
        try {
          console.log(
            `[speculum-context] scope_admitted childContextId=${childContextId} parentContextId=${parentContextId} hostNodeId=${hostNodeId} deliverable=${deliverable}`,
          );
        } catch {
          /* */
        }
      }
    },
    // Host row gone (inner nav / removal): the dead install's port must not survive it (§8).
    onDrop: (contextId) => bus.closeChildChannel(contextId),
  });

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

  // 2. Observer + bus listeners BEFORE the await (§5, both rules).
  //    Observing after `initContext` loses everything the parser inserted during it; the bus
  //    listener must already be up because a *child* of this context can ask before this
  //    context has its own id — that request queues instead of being lost.
  domMutationObserver.start();
  bus.openUpwardChannel();

  // 3. `initContext` — the activation gate. Nested asks its parent; the root asks the authority
  //    above it. Terminal policy is asymmetric on purpose: an ad iframe nobody admits is not a
  //    broken session, but a root with no authority is (§5 terminal policy).
  let identity: ContextIdentity | null;
  if (isRoot) {
    try {
      identity = await initRootContext(resolveRootUpwardPeer(), ROOT_INIT_CONTEXT_TIMEOUT_MS);
    } catch {
      identity = null;
    }
  } else {
    identity = await initNestedContext(bus, NESTED_INIT_CONTEXT_TIMEOUT_MS);
  }

  if (identity === null) {
    setBootOutcome('init_context_timeout', {
      detail: {
        timeoutMs: isRoot ? ROOT_INIT_CONTEXT_TIMEOUT_MS : NESTED_INIT_CONTEXT_TIMEOUT_MS,
        upwardReady: bus.upwardReady,
        initDetail: (bus as { lastInitContextDetail?: unknown }).lastInitContextDetail ?? null,
      },
    });
    bootDiagLog('boot_dormant', {
      reason: 'init_context_timeout',
      timeoutMs: isRoot ? ROOT_INIT_CONTEXT_TIMEOUT_MS : NESTED_INIT_CONTEXT_TIMEOUT_MS,
    });
    domMutationObserver.unobserveAllRoots();
    mutationBuffer.drain();
    bus.dispose();
    return;
  }

  const mine = identity.contextId;
  domNodes.setGeneration(identity.generation);
  bus.setMine(mine);

  // Register invoke BEFORE establish/hello so sidecar probes during the open race
  // never see a live socket with a null handler (in-page hard nav is the worst case).
  type ProducerApi = NonNullable<(typeof globalThis)['__speculumProjection']>;
  let producerApi: ProducerApi | null = null;
  if (dataPlane) {
    dataPlane.setInvokeHandler(async (name, args) => {
      const p = producerApi ?? globalThis.__speculumProjection;
      if (!p) throw new Error('producer_booting');
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
          const a = (args ?? {}) as {
            nodeId?: number;
            contextId?: number;
            localX?: number;
            localY?: number;
            x?: number;
            y?: number;
          };
          if (typeof a.nodeId !== 'number') {
            throw new Error('resolveNodeHit: missing nodeId');
          }
          return p.resolveNodeHit({
            nodeId: a.nodeId,
            contextId: a.contextId,
            localX: a.localX,
            localY: a.localY,
            x: a.x,
            y: a.y,
          });
        }
        case 'measureNodeRect': {
          const a = (args ?? {}) as { nodeId?: number; contextId?: number };
          if (typeof a.nodeId !== 'number') {
            throw new Error('measureNodeRect: missing nodeId');
          }
          return p.measureNodeRect({ nodeId: a.nodeId, contextId: a.contextId });
        }
        case 'measureTurnstileRootRects':
          return p.measureTurnstileRootRects();
        case 'measureNodePaint': {
          const a = (args ?? {}) as { nodeId?: number; contextId?: number };
          if (typeof a.nodeId !== 'number') {
            throw new Error('measureNodePaint: missing nodeId');
          }
          return p.measureNodePaint({ nodeId: a.nodeId, contextId: a.contextId });
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
        case 'evaluateInContext': {
          const a = (args ?? {}) as { contextId?: number; expression?: string };
          return p.evaluateInContext({
            contextId: a.contextId,
            expression: a.expression ?? '',
          });
        }
        case 'listChildScopeHosts':
          return p.listChildScopeHosts();
        default:
          throw new Error(`unknown loopback invoke: ${name}`);
      }
    });
  }

  if (rootRuntime !== null) {
    try {
      await rootRuntime.establishConnection(identity.generation);
    } catch (err) {
      throw new Error(
        `[speculumProjection] data plane establish failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Sidecar may RPC as soon as hello-ack lands; seed encode of large documents can take
  // seconds. Expose a bootstrapping producer so probes do not sit on `producer_booting`.
  const bootProducer = {
    applyScrollSet: async () => ({ ok: true as const }),
    keyOfSelector: async () => ({ ok: false as const, reason: 'producer_booting' }),
    resolveElementHit: async () => ({ ok: false as const, reason: 'producer_booting' }),
    resolveNodeHit: async () => ({ ok: false as const, reason: 'producer_booting' }),
    measureNodeRect: async () => ({ ok: false as const, reason: 'producer_booting' }),
    measureNodePaint: async () => ({ ok: false as const, reason: 'producer_booting' }),
    measureTurnstileRootRects: async () => ({ ok: false as const, reason: 'producer_booting' }),
    listChildScopeHosts: async () => ({ ok: false as const, reason: 'producer_booting', hosts: [], generation: 0 }),
    haltWorld: () => {},
    resumeWorld: () => {},
    flushFrame: () => ({ generation: identity.generation, sequence: 0 }),
    snapshotContext: async () => {
      throw new Error('producer_booting');
    },
  };
  producerApi = bootProducer as unknown as ProducerApi;

  // 4. Activate.
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

  // Nested: seed after parse settles. Cold rebuild during `loading` walks a partial
  // tree; MO then drops childList under not-yet-mapped parents → live nodes stay
  // unmapped (`keyOfSelector` → `node_unmapped`, lab input-iframe-click).
  //
  // Do NOT register mintFn.onSettled→flushNow before cold resync: a mint that settles during
  // depth≥2 admit re-enters the incremental builder and wedges the main thread
  // (assert-iframe-nested-boot). Wire it after sendInitial instead.
  if (!isRoot) {
    await waitDocumentSeedReady(document);
  }

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

  function clientPointInLocalViewport(el: Element): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function isHitOnHostComposedPath(hit: Element | null, host: Element): boolean {
    // Retarget only walks outward: elementFromPoint returns an ancestor of the
    // real target, never a descendant — walk from host toward document root.
    let el: Element | null = host;
    while (el) {
      if (el === hit) return true;
      const root = el.getRootNode();
      if (root instanceof ShadowRoot) {
        el = root.host;
        continue;
      }
      el = el.parentElement;
    }
    return false;
  }

  function verifyHostAtPoint(x: number, y: number, hostNodeId: number): { ok: boolean; reason?: string } {
    const host = domNodes.get(hostNodeId);
    if (!host || host.nodeType !== Node.ELEMENT_NODE) return { ok: false, reason: 'host_not_found' };
    const hit = document.elementFromPoint(x, y);
    if (!isHitOnHostComposedPath(hit, host as Element)) {
      return { ok: false, reason: 'point_outside_host' };
    }
    return { ok: true };
  }

  async function composeViewportPointToRoot(
    leafContextId: number,
    localX: number,
    localY: number,
  ): Promise<{
    ok: boolean;
    x?: number;
    y?: number;
    reason?: string;
    firstHopContextId?: number;
    hostNodeId?: number;
  }> {
    if (!lineage) return { ok: false, reason: 'no_lineage' };
    if (leafContextId === CONTEXT_ID_ROOT) {
      return { ok: true, x: localX, y: localY, firstHopContextId: CONTEXT_ID_ROOT };
    }
    const chain = lineage.chainLeafToRoot(leafContextId);
    if (chain.length === 0) return { ok: false, reason: 'lineage_missing' };
    let x = localX;
    let y = localY;
    for (const childCtx of chain) {
      const parentCtx = lineage.getParent(childCtx);
      if (parentCtx === undefined) return { ok: false, reason: 'lineage_missing' };
      const hopR = await bus.requestChildViewportOriginInMe(parentCtx, childCtx);
      if (!hopR.ok || hopR.dx === undefined || hopR.dy === undefined) {
        return { ok: false, reason: hopR.reason ?? 'hop_failed' };
      }
      const hop: ViewportHop = {
        dx: hopR.dx,
        dy: hopR.dy,
        scale: hopR.scale ?? 1,
      };
      ({ x, y } = mapPointAcrossHop(x, y, hop));
    }
    const firstHop = lineage.directChildOfRootOnPath(leafContextId);
    const hostNodeId = firstHop === CONTEXT_ID_ROOT ? undefined : childScopes.nodeIdOf(firstHop);
    if (hostNodeId !== undefined) {
      const verify = verifyHostAtPoint(x, y, hostNodeId);
      if (!verify.ok) return { ok: false, reason: verify.reason };
    }
    return { ok: true, x, y, firstHopContextId: firstHop, hostNodeId };
  }

  bus.onInvocation('childViewportOriginInMe', (args: { childContextId: number }) => {
    const nodeId = childScopes.nodeIdOf(args.childContextId);
    if (nodeId === undefined) return { ok: false as const, reason: 'child_not_found' };
    const node = domNodes.get(nodeId);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return { ok: false as const, reason: 'host_not_element' };
    }
    const hop = iframeContentBoxOrigin(node as HTMLElement);
    return { ok: true as const, dx: hop.dx, dy: hop.dy, scale: hop.scale };
  });

  if (lineage) {
    bus.onInvocation(
      'registerScopeLineage',
      (args: { childContextId: number; parentContextId: number }) => {
        lineage.register(args.childContextId, args.parentContextId);
        return { ok: true as const };
      },
    );
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

  function listChildScopeHostsSnapshot(): {
    ok: true;
    generation: number;
    hosts: Array<{
      contextId: number;
      hostNodeId: number;
      domId: string | null;
      src: string;
      w: number;
      h: number;
      isConnected: boolean;
    }>;
  } {
    frameEmitter.flushNow();
    const hosts: Array<{
      contextId: number;
      hostNodeId: number;
      domId: string | null;
      src: string;
      w: number;
      h: number;
      isConnected: boolean;
    }> = [];
    childScopes.forEachBinding((contextId, nodeId) => {
      const node = domNodes.get(nodeId);
      if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        hosts.push({
          contextId,
          hostNodeId: nodeId,
          domId: null,
          src: '',
          w: 0,
          h: 0,
          isConnected: false,
        });
        return;
      }
      const el = node as HTMLElement;
      hosts.push({
        contextId,
        hostNodeId: nodeId,
        domId: el.id || null,
        src: (el.getAttribute('src') || '').slice(0, 512),
        w: el.offsetWidth,
        h: el.offsetHeight,
        isConnected: el.isConnected,
      });
    });
    return { ok: true, generation: domNodes.generation, hosts };
  }

  bus.onInvocation('listChildScopeHosts', () => listChildScopeHostsSnapshot());

  bus.onInvocation('evaluateExpression', (args: { expression: string }) => {
    try {
      // Lab-only — trusted fixture probe from sidecar.
      const value = (0, eval)(args.expression);
      return { ok: true as const, value };
    } catch (err) {
      return {
        ok: false as const,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  });

  bus.onInvocation('resolveElementHit', (args: { selector: string }) => {
    frameEmitter.flushNow();
    const el = document.querySelector(args.selector);
    if (!el) return { ok: false as const, reason: 'selector_miss' };
    const { x, y } = clientPointInLocalViewport(el);
    const win = document.defaultView;
    const scrollX = win?.scrollX || document.scrollingElement?.scrollLeft || 0;
    const scrollY = win?.scrollY || document.scrollingElement?.scrollTop || 0;
    const nodeIdRaw = domNodes.keyOf(el);
    const nodeId = nodeIdRaw === NONE_DOM_NODE_KEY ? null : nodeIdRaw;
    return { ok: true as const, x, y, scrollX, scrollY, nodeId };
  });

  bus.onInvocation('resolveNodeHit', (args: {
    nodeId: number;
    localX?: number;
    localY?: number;
    x?: number;
    y?: number;
  }) => {
    frameEmitter.flushNow();
    const node = domNodes.get(args.nodeId);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return { ok: false as const, reason: 'node_not_found' };
    }
    const el = node as Element;
    const hasLocal =
      typeof args.localX === 'number'
      && typeof args.localY === 'number'
      && Number.isFinite(args.localX)
      && Number.isFinite(args.localY);
    if (hasLocal) {
      const mapped = mapLocalHitToRootPoint(
        elementLocalViewportRect(el),
        args.localX as number,
        args.localY as number,
      );
      if (!mapped) return { ok: false as const, reason: 'bad_local' };
      return { ok: true as const, x: mapped.x, y: mapped.y };
    }
    const { x, y } = clientPointInLocalViewport(el);
    return { ok: true as const, x, y };
  });

  bus.onInvocation('measureNodeRect', (args: { nodeId: number }) => {
    frameEmitter.flushNow();
    const node = domNodes.get(args.nodeId);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return { ok: false as const, reason: 'not_element' };
    }
    const el = node as Element;
    const r = el.getBoundingClientRect();
    const win = document.defaultView;
    const cs = win ? win.getComputedStyle(el) : null;
    const htmlEl = el as HTMLElement;
    return {
      ok: true as const,
      tagName: el.tagName.toLowerCase(),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      offsetWidth: htmlEl.offsetWidth,
      offsetHeight: htmlEl.offsetHeight,
      display: cs?.display ?? null,
      visibility: cs?.visibility ?? null,
      hasSrcAttr: el.hasAttribute('src'),
      src: el.getAttribute('src'),
    };
  });

  bus.onInvocation('measureNodePaint', (args: { nodeId: number }) => {
    frameEmitter.flushNow();
    const node = domNodes.get(args.nodeId);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return { ok: false as const, reason: 'not_element' };
    }
    const el = node as Element;
    const win = document.defaultView;
    const cs = win ? win.getComputedStyle(el) : null;
    if (!cs) return { ok: false as const, reason: 'no_computed_style' };
    return {
      ok: true as const,
      paint: {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        opacity: cs.opacity,
        visibility: cs.visibility,
        display: cs.display,
        borderTopWidth: cs.borderTopWidth,
        borderTopColor: cs.borderTopColor,
        borderTopStyle: cs.borderTopStyle,
        width: cs.width,
        height: cs.height,
      },
    };
  });

  bus.onInvocation('measureTurnstileRootRects', () => {
    frameEmitter.flushNow();
    const sample = (el: Element | null, name: string) => {
      if (!el) return { name, ok: false as const, reason: 'missing' as const };
      const r = el.getBoundingClientRect();
      const win = el.ownerDocument.defaultView;
      const cs = win ? win.getComputedStyle(el) : null;
      const htmlEl = el as HTMLElement;
      const isIframe = el.tagName === 'IFRAME';
      return {
        name,
        ok: true as const,
        tagName: el.tagName.toLowerCase(),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        offsetWidth: htmlEl.offsetWidth,
        offsetHeight: htmlEl.offsetHeight,
        display: cs?.display ?? null,
        visibility: cs?.visibility ?? null,
        hasSrcAttr: isIframe ? el.hasAttribute('src') : null,
        src: isIframe ? el.getAttribute('src') : null,
      };
    };
    const findCfIframe = (): { iframe: HTMLIFrameElement | null; shadowHost: Element | null } => {
      const queue: Array<{ node: Node; shadowHost: Element | null }> = [
        { node: document.documentElement, shadowHost: null },
      ];
      while (queue.length > 0) {
        const { node: n, shadowHost } = queue.shift()!;
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const el = n as Element;
        if (el.tagName === 'IFRAME') {
          const id = el.id || '';
          const src = el.getAttribute('src') || '';
          if (id.startsWith('cf-chl') || /challenges\.cloudflare\.com|turnstile/i.test(src)) {
            const hostFromRoot =
              shadowHost ??
              (el.getRootNode() instanceof ShadowRoot
                ? ((el.getRootNode() as ShadowRoot).host as Element)
                : null);
            return { iframe: el as HTMLIFrameElement, shadowHost: hostFromRoot };
          }
        }
        const sr = resolveShadowRoot(el);
        if (sr) {
          for (const c of Array.from(sr.childNodes)) queue.push({ node: c, shadowHost: el });
        }
        for (const c of Array.from(el.childNodes)) queue.push({ node: c, shadowHost });
      }
      return { iframe: null, shadowHost: null };
    };
    const { iframe, shadowHost } = findCfIframe();
    return {
      ok: true as const,
      levels: [
        sample(iframe, 'nested_host_iframe_in_root'),
        sample(shadowHost, 'root_shadow_host'),
        sample(document.documentElement, 'root_documentElement'),
      ],
    };
  });

  bus.onResyncRequest((req) => {
    if (req.contextId !== mine) return;
    frameEmitter.requestResync((seq) => {
      const { frame, cssom: cssomStats, mintPending } = emitResyncFrame(resyncPlanes, seq);
      telemetry.recordCssomPoll(cssomStats);
      // A resync frame *is* the surface: shipping it with a nested host omitted would establish a
      // hole. Hold the request and rebuild when the mint settles (§0 #4).
      if (mintPending) return null;
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

  // Cold seed. A nested host whose mint is still in flight would be *omitted* from the frame that
  // establishes the whole surface, so rebuild once the RPC settles instead (§0 #4). Bounded by
  // the same budget as `initContext`: if no id ever arrives, this context is dormant, never
  // half-projected. No `EPOCH_RESET` prepend — a generation change is stated by the header alone
  // and the client answers it by rebuilding its applier (§7).
  let resync = rebuildAndResync(resyncPlanes, frameEmitter.currentSequence + 1);
  const mintDeadline = Date.now() + NESTED_INIT_CONTEXT_TIMEOUT_MS;
  while (resync.mintPending && Date.now() < mintDeadline) {
    // whenSettled must not outlive the deadline — a hung RPC used to park activate forever
    // after hello (sidecar saw established + producer_booting).
    const remaining = Math.max(1, mintDeadline - Date.now());
    await Promise.race([
      mintFn.whenSettled(),
      new Promise<void>((resolve) => setTimeout(resolve, remaining)),
    ]);
    resync = rebuildAndResync(resyncPlanes, frameEmitter.currentSequence + 1);
  }
  if (resync.mintPending) {
    setBootOutcome('nested_host_mint_pending', { contextId: mine });
    bootDiagLog('boot_dormant', { contextId: mine, reason: 'nested_host_mint_pending' });
    domMutationObserver.unobserveAllRoots();
    mutationBuffer.drain();
    bus.dispose();
    // Hello already ran — do not leave a ghost established socket on the sidecar.
    rootRuntime?.dispose();
    loopback?.close();
    return;
  }
  const { frame: resyncFrame, cssom: cssomResyncStats } = resync;
  telemetry.recordCssomPoll(cssomResyncStats);
  domMutationObserver.takePendingIntoBuffer();
  mutationBuffer.drain();
  await frameEmitter.sendInitial(resyncFrame);
  bootDiagLog('boot_initial_sent', {
    contextId: mine,
    sequence: resyncFrame.sequence,
    generation: resyncFrame.generation,
    resync: resyncFrame.flags.resync === true,
    opCount: resyncFrame.ops.length,
  });
  domMutationObserver.syncObservedShadowRoots(domNodes);

  // After cold seed only — see comment at the previous mintFn.onSettled site.
  mintFn.onSettled(() => frameEmitter.flushNow());

  frameEmitter.start();
  telemetry.start();
  cssom.start();

  /**
   * bfcache restore (runtime-redesign.md §0 #8 / M3). A restored document is the *same* install
   * from the page's point of view but a new one from the carrier's: the parent closed the port
   * when the document left, and the client's replica is stale. So: re-run the port setup, ask
   * `initContext` again, adopt the generation it states, and let the client rebuild off the new
   * generation instead of trying to resume a sequence nobody kept.
   */
  window.addEventListener('pageshow', (event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    void (async () => {
      frameEmitter.stop();
      cssom.halt();
      bus.reopenUpwardChannel();
      const again = isRoot
        ? await initRootContext(resolveRootUpwardPeer(), ROOT_INIT_CONTEXT_TIMEOUT_MS)
        : await initNestedContext(bus, NESTED_INIT_CONTEXT_TIMEOUT_MS);
      if (again === null) {
        bootDiagLog('boot_dormant', { contextId: mine, reason: 'bfcache_init_context_timeout' });
        domMutationObserver.unobserveAllRoots();
        mutationBuffer.drain();
        bus.dispose();
        return;
      }
      if (rootRuntime !== null) {
        await rootRuntime.establishConnection(again.generation);
      }
      domNodes.setGeneration(again.generation);
      bus.publishResyncRequest({ contextId: mine, reason: 'bfcache_restore' });
      frameEmitter.start();
      cssom.start();
      bootDiagLog('boot_reinit', { contextId: mine, generation: again.generation });
    })();
  });

  // Each producer context (root + nested) exposes tree capture for bus snapshot RPC (`includeTree`).
  (globalThis as { __speculumSnapshot?: { snapshotTree: typeof snapshotTree } }).__speculumSnapshot = {
    snapshotTree,
  };
  (globalThis as { __speculumResolveShadowRoot?: typeof resolveShadowRoot }).__speculumResolveShadowRoot =
    resolveShadowRoot;

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
      const local = await bus.requestResolveElementHit(contextId, args.selector);
      if (!local.ok || local.x === undefined || local.y === undefined) return local;
      if (contextId === CONTEXT_ID_ROOT) return local;
      const composed = await composeViewportPointToRoot(contextId, local.x, local.y);
      if (!composed.ok) return composed;
      return { ...local, x: composed.x, y: composed.y };
    },
    resolveNodeHit: async (args) => {
      const contextId =
        typeof args.contextId === 'number' && args.contextId > 0 ? args.contextId : CONTEXT_ID_ROOT;
      const local = await bus.requestResolveNodeHit(contextId, args.nodeId, args.localX, args.localY);
      if (!local.ok || local.x === undefined || local.y === undefined) return local;
      if (contextId === CONTEXT_ID_ROOT) return local;
      const composed = await composeViewportPointToRoot(contextId, local.x, local.y);
      if (!composed.ok) return composed;
      return {
        ok: true as const,
        x: composed.x,
        y: composed.y,
        firstHopContextId: composed.firstHopContextId,
        hostNodeId: composed.hostNodeId,
      };
    },
    measureNodeRect: async (args) => {
      const contextId =
        typeof args.contextId === 'number' && args.contextId > 0 ? args.contextId : CONTEXT_ID_ROOT;
      return bus.requestMeasureNodeRect(contextId, args.nodeId);
    },
    measureTurnstileRootRects: async () => bus.requestMeasureTurnstileRootRects(CONTEXT_ID_ROOT),
    measureNodePaint: async (args) => {
      const contextId =
        typeof args.contextId === 'number' && args.contextId > 0 ? args.contextId : CONTEXT_ID_ROOT;
      return bus.requestMeasureNodePaint(contextId, args.nodeId);
    },
    evaluateInContext: async (args: {
      contextId?: number;
      expression: string;
    }) => {
      const contextId =
        typeof args.contextId === 'number' && args.contextId > 0 ? args.contextId : CONTEXT_ID_ROOT;
      if (contextId === CONTEXT_ID_ROOT) {
        try {
          const value = (0, eval)(args.expression);
          return { ok: true as const, value };
        } catch (err) {
          return { ok: false as const, reason: err instanceof Error ? err.message : String(err) };
        }
      }
      return bus.requestEvaluateExpression(contextId, args.expression);
    },
    listChildScopeHosts: async () => listChildScopeHostsSnapshot(),
  };
  const timingBag = (globalThis as { __SPECULUM_LAUNCH_TIMING__?: Record<string, unknown> })
    .__SPECULUM_LAUNCH_TIMING__;
  setBootOutcome('established', {
    ok: true,
    contextId: mine,
    detail: {
      sequence: frameEmitter.currentSequence,
      generation: identity.generation,
      configGateMs: (timingBag?.configGate as { durationMs?: number } | undefined)?.durationMs ?? null,
      configGateAttempts: (timingBag?.configGate as { attempts?: number } | undefined)?.attempts ?? null,
      initContextMs: (timingBag?.initContext as { durationMs?: number } | undefined)?.durationMs ?? null,
      initContextAttempts: (timingBag?.initContext as { attempts?: number } | undefined)?.attempts ?? null,
    },
  });
  bootDiagLog('boot_established', {
    contextId: mine,
    sequence: frameEmitter.currentSequence,
    isRoot: window.parent === window,
  });
  try {
    console.log(
      `[speculum-context] boot_established contextId=${mine} isRoot=${window.parent === window} href=${location.href}`,
    );
  } catch {
    /* */
  }

  producerApi = globalThis.__speculumProjection ?? null;
  } catch (err) {
    setBootOutcome('bootstrap_throw', {
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    console.error('[speculumProjection] bootstrap failed', err);
  }
})();
