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
import { DOCUMENT_ID } from '../models/frame';
import { OpCode } from '../models/opcodes';
import { ReplicatedTable } from '../models/replicatedTable';
import { BinaryFrameEncoder } from './frame/binaryFrameEncoder';
import { FrameEmitter } from './frame/frameEmitter';
import { emitResyncFrame, rebuildAndResync, type ResyncPlanes } from './resync';
import { takeSnapshot } from './snapshot';
import { TableFrameBuilder } from './dom/tableFrameBuilder';
import { CssomIds } from './cssom/cssomIds';
import { CssomPoller } from './cssom/cssomPoller';
import { CssomIdleScheduler } from './cssom/cssomIdleScheduler';
import { disabledCssomPlane, type CssomPlane } from './cssom/cssomPlane';
import { ProjectionTelemetry } from './telemetry/projectionTelemetry';
import type { FrameTransport } from './transport/frameTransport';
import { ConsoleFrameTransport } from './transport/consoleFrameTransport';
import { LoopbackFrameTransport } from './transport/loopbackFrameTransport';
import { NullFrameTransport } from './transport/nullFrameTransport';
import type { TableLiveOracleResult } from '../models/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '../models/cssomTableLiveOracle';
import { compareTableToLiveDom } from './dom/tableLiveOracle';
import { PlaneChannel, type DataPlane } from '../plane';
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
      }
    | undefined;
}

document.currentScript?.remove();

void (async () => {
  if (globalThis.__speculumProjection) return;

  const config = readProjectionConfig();

  const domNodes = new DomNodeTable();
  domNodes.bind(document, DOCUMENT_ID);
  domNodes.setGeneration(config.generation);
  const table = new ReplicatedTable();

  const mutationBuffer = new MutationBuffer();
  const domMutationObserver = new DomMutationObserver({ buffer: mutationBuffer });
  const frameBuilder = new TableFrameBuilder({ domNodes, table });
  const encoder = new BinaryFrameEncoder({ maxFrameBytes: config.maxFrameBytes });

  let frameTransport: FrameTransport;
  let dataPlane: DataPlane | null = null;
  let loopback: LoopbackFrameTransport | null = null;
  if (config.transport === 'console') {
    frameTransport = new ConsoleFrameTransport();
  } else if (config.transport === 'discard') {
    frameTransport = new NullFrameTransport();
  } else {
    loopback = new LoopbackFrameTransport({
      bufferedAmountWatermark: config.bufferedAmountWatermark,
    });
    loopback.open(config.dataPlaneUrl);
    frameTransport = loopback;
    dataPlane = loopback.dataPlane;
  }

  const telemetry = new ProjectionTelemetry({
    config: config.telemetry,
    dataPlane,
  });

  const cssomPoller =
    config.cssomPollHz > 0 ? new CssomPoller(new CssomIds(() => domNodes.mint())) : null;
  const cssom: CssomPlane =
    cssomPoller !== null
      ? new CssomIdleScheduler({
          poller: cssomPoller,
          minIntervalMs: 1000 / config.cssomPollHz,
        })
      : disabledCssomPlane();

  const resyncPlanes: ResyncPlanes = { domNodes, table, cssom };

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
      const req = msg as { type?: unknown; reason?: unknown; generation?: unknown; sequence?: unknown };
      if (req.type !== 'requestResync') return;
      console.log(
        '[speculumProjection] resync requested — reason=%s clientGeneration=%s clientSequence=%s',
        String(req.reason),
        String(req.generation),
        String(req.sequence),
      );
      frameEmitter.requestResync((seq) => {
        const { frame, cssom: cssomStats } = emitResyncFrame(resyncPlanes, seq);
        telemetry.recordCssomPoll(cssomStats);
        return frame;
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

  frameEmitter.start();
  telemetry.start();
  cssom.start();

  globalThis.__speculumProjection = {
    version: 1,
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
    },
    resumeWorld: () => {
      frameEmitter.start();
      cssom.start();
    },
    flushFrame: () => {
      frameEmitter.flushNow();
      return { generation: domNodes.generation, sequence: frameEmitter.currentSequence };
    },
    flushAndSnapshot: (opts) => {
      const snapped = takeSnapshot(
        {
          domNodes,
          table,
          cssom,
          cssomIds: cssomPoller?.ids ?? null,
          currentSequence: () => frameEmitter.currentSequence,
          flushDom: () => frameEmitter.flushNow(),
          recordCssomPoll: (stats) => telemetry.recordCssomPoll(stats),
        },
        { cssom: opts?.cssom ?? 'none' },
      );
      frameEmitter.stop();
      cssom.halt();
      return snapped;
    },
  };
})();
