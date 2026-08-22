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
import { ProjectionBus } from './bus/projectionBus';
import { RootRuntime } from './runtime/rootRuntime';
import { ChildScopeIndex, createMintPort } from './dom/childScopes';
import type { TableLiveOracleResult } from '../core/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '../core/cssomTableLiveOracle';
import { compareTableToLiveDom } from './dom/tableLiveOracle';
import { PlaneChannel, type DataPlane } from '../core/plane';
import type { CssomPollStats } from './cssom/cssomPoller';

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
          | { ok: true; value: import('./bus/projectionBus').SnapshotRpcPayload }
          | { ok: false; reason: string }
        >;
        snapshotAllKnown: (
          contextIds: number[],
          opts?: { cssom?: 'none' | 'committed' | 'scan'; includeTree?: boolean },
        ) => Promise<Record<number, import('./bus/projectionBus').SnapshotRpcPayload | { ok: false; reason: string }>>;
        resumeContext: (contextId: number) => Promise<{ ok: boolean; reason?: string }>;
        resumeAllKnown: (contextIds: number[]) => Promise<Record<number, { ok: boolean; reason?: string }>>;
      }
    | undefined;
}

document.currentScript?.remove();

void (async () => {
  if (globalThis.__speculumProjection) return;

  const config = readProjectionConfig();
  const isRoot = window.parent === window;
  let mine = CONTEXT_ID_ROOT;
  let frameTransport: FrameTransport;
  let dataPlane: DataPlane | null = null;
  let loopback: LoopbackFrameTransport | null = null;
  let bus: ProjectionBus;
  let mintFn: () => number | null;

  if (isRoot) {
    const runtime = new RootRuntime(config, window);
    loopback = runtime.loopback;
    frameTransport = runtime.frameTransport;
    dataPlane = runtime.dataPlane;
    bus = runtime.bus;
    mintFn = () => runtime.mint();
    mine = CONTEXT_ID_ROOT;
  } else {
    bus = new ProjectionBus({ window, parent: window.parent, role: 'nested' });
    frameTransport = new BusFrameTransport(bus);
    mintFn = createMintPort({ requestMint: () => bus.requestMint() });
    mine = await bus.getScopeId();
  }

  const childScopes = new ChildScopeIndex(mintFn);

  const domNodes = new DomNodeTable();
  bus.setScopeLookup((source) =>
    childScopes.lookupByContentWindow(source, (id) => domNodes.get(id)),
  );
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

  if (loopback) {
    try {
      await loopback.whenOpen();
    } catch (err) {
      console.error('[speculumProjection] data plane open failed', err);
    }
  }

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

  bus.onResyncRequest((req) => {
    if (req.contextId !== mine) return;
    frameEmitter.requestResync((seq) => {
      const { frame, cssom: cssomStats } = emitResyncFrame(resyncPlanes, seq);
      telemetry.recordCssomPoll(cssomStats);
      return frame;
    });
  });

  if (loopback) {
    loopback.dataPlane.setHandler((channel, payload) => {
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
      if (req.type !== 'requestResync') return;
      const contextId =
        typeof req.contextId === 'number' && req.contextId > 0 ? req.contextId : CONTEXT_ID_ROOT;
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
  };
})();
