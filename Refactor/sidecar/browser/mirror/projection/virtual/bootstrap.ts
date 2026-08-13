/**
 * Virtual-side PageProjection bootstrap — sole esbuild entry for Isolated World.
 * DOM seal: establish → live MO/emitter; telemetry push on DataPlane.
 */

import type { FrameClock } from './clock/frameClock';
import { TimerFrameClock } from './clock/timerFrameClock';
import { readProjectionConfig } from './config/projectionConfig';
import { DomMutationAccumulator } from './dom/domMutationAccumulator';
import { DomMutationObserver } from './dom/domMutationObserver';
import { DomNodeTable } from './dom/domNodeTable';
import { buildEstablishDomFrame } from './establish/establishDom';
import { BinaryFrameEncoder } from './frame/binaryFrameEncoder';
import { FrameEmitter } from './frame/frameEmitter';
import { NetEffectFrameBuilder } from './frame/netEffectFrameBuilder';
import { isPublishableNode } from './frame/fVisible';
import { ProjectionTelemetry } from './telemetry/projectionTelemetry';
import type { FrameTransport } from './transport/frameTransport';
import { ConsoleFrameTransport } from './transport/consoleFrameTransport';
import { LoopbackFrameTransport } from './transport/loopbackFrameTransport';
import type { DataPlane } from '../plane';
import { attachStateSensors } from './dom/stateSensors';
import { attachScrollSensors } from './dom/scrollSensors';

declare global {
  var __speculumProjection:
    | {
        readonly version: 1;
        readonly domNodes: DomNodeTable;
        readonly frameClock: FrameClock;
        readonly domMutationAccumulator: DomMutationAccumulator;
        readonly domMutationObserver: DomMutationObserver;
        readonly frameBuilder: NetEffectFrameBuilder;
        readonly frameEmitter: FrameEmitter;
        readonly frameTransport: FrameTransport;
        readonly telemetry: ProjectionTelemetry;
      }
    | undefined;
}

void (async () => {
  if (globalThis.__speculumProjection) return;

  const config = readProjectionConfig();

  const domNodes = new DomNodeTable();
  const domMutationAccumulator = new DomMutationAccumulator();
  const domMutationObserver = new DomMutationObserver({
    domNodes,
    accumulator: domMutationAccumulator,
    isPublishable: isPublishableNode,
  });
  const frameBuilder = new NetEffectFrameBuilder({ domNodes });
  const encoder = new BinaryFrameEncoder({ maxFrameBytes: config.maxFrameBytes });

  let frameTransport: FrameTransport;
  let dataPlane: DataPlane | null = null;
  let loopback: LoopbackFrameTransport | null = null;
  if (config.transport === 'console') {
    frameTransport = new ConsoleFrameTransport();
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
  attachStateSensors({ domNodes, accumulator: domMutationAccumulator });
  attachScrollSensors({ domNodes, accumulator: domMutationAccumulator });

  if (loopback) {
    try {
      await loopback.whenOpen();
    } catch (err) {
      console.error('[speculumProjection] data plane open failed', err);
    }
  }

  telemetry.recordEstablishStarted(domNodes.generation);

  let establishOk = false;
  try {
    const established = buildEstablishDomFrame({
      domNodes,
      generation: domNodes.generation,
      sequence: 0,
    });
    frameBuilder.seedPublished(established.publishedKeys);
    frameBuilder.seedChildLists(established.childLists);
    const parts = encoder.encode(established.frame);
    for (let i = 0; i < parts.length; i++) {
      let result = frameTransport.send(parts[i]!);
      let spins = 0;
      while (result === 'deferred' && spins < 50) {
        await new Promise((r) => setTimeout(r, 20));
        result = frameTransport.send(parts[i]!);
        spins += 1;
      }
    }
    const bytes = parts.reduce((n, p) => n + p.length, 0);
    establishOk = true;
    telemetry.recordEstablishCompleted({
      generation: established.frame.generation,
      nodeCount: established.nodeCount,
      checksum: established.checksum,
      bytes,
      tableSize: domNodes.size,
    });
    telemetry.recordFrameEmitted({
      generation: established.frame.generation,
      sequence: established.frame.sequence,
      opCount: established.frame.ops.length,
      partCount: parts.length,
      bytes,
      establish: true,
    });
    telemetry.recordEncoder({
      generation: established.frame.generation,
      sequence: established.frame.sequence,
      partCount: parts.length,
      bytes,
      maxFrameBytes: encoder.maxFrameBytes,
    });
    const publish = frameBuilder.publishState();
    telemetry.recordHandoff({
      generation: established.frame.generation,
      publishedCount: publish.publishedCount,
      tableSize: domNodes.size,
      lastChildListsSeeded: publish.lastChildListsParents > 0,
      lastChildListsParents: publish.lastChildListsParents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[speculumProjection] establish failed', err);
    telemetry.recordEstablishFailed(domNodes.generation, message);
  }

  const frameEmitter = new FrameEmitter({
    clock: frameClock,
    accumulator: domMutationAccumulator,
    builder: frameBuilder,
    encoder,
    transport: frameTransport,
    domNodes,
    telemetry,
  });

  if (establishOk) frameEmitter.setCurrentSequence(0);

  frameEmitter.start();
  telemetry.start();

  globalThis.__speculumProjection = {
    version: 1,
    domNodes,
    frameClock,
    domMutationAccumulator,
    domMutationObserver,
    frameBuilder,
    frameEmitter,
    frameTransport,
    telemetry,
  };
})();
