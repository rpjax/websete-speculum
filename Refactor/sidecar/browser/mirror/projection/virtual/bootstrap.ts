/**
 * Virtual-side PageProjection bootstrap — sole esbuild entry for Isolated World.
 * MutationObserver → buffer → emitter, per frame-protocol.md §5. No establish (§4.7) — but,
 * corrected 2026-08-13 (§5.1), the observer does **not** reliably attach before the parser
 * produces content, so cold start is not purely "ordinary frames against an empty table": one
 * synchronous `resyncVirtual` call (§5.8) runs immediately after `observe()` to walk whatever the
 * parser already produced and populate the table from it, before the ordinary tick loop starts.
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
import { emitResyncFrame, resyncVirtual } from './frame/resync';
import { TableFrameBuilder } from './frame/tableFrameBuilder';
import { ProjectionTelemetry } from './telemetry/projectionTelemetry';
import type { FrameTransport } from './transport/frameTransport';
import { ConsoleFrameTransport } from './transport/consoleFrameTransport';
import { LoopbackFrameTransport } from './transport/loopbackFrameTransport';
import { NullFrameTransport } from './transport/nullFrameTransport';
import { PlaneChannel, type DataPlane } from '../plane';

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
      }
    | undefined;
}

// Patchright's `addInitScript` leaves its own `<script>` tag attached to the document (unlike
// a raw invisible CDP `Page.addScriptToEvaluateOnNewDocument` context, which this is NOT — a
// real, connected DOM node). Left in place, `resyncVirtual`'s walk (§5.8) — and every ordinary
// tick's MutationObserver after it — treats it as real page content and mirrors it: found via
// the 2026-08-13 "48KB first frame for 34 nodes" diagnosis, where the entire ~46KB bundle
// source text of *this script* was the dominant string in its own first frame. `currentScript`
// is only valid for the synchronous portion of this script's execution — must run before
// anything else, including before any `await`.
document.currentScript?.remove();

void (async () => {
  if (globalThis.__speculumProjection) return;

  const config = readProjectionConfig();

  const domNodes = new DomNodeTable();
  domNodes.bind(document, DOCUMENT_ID);
  // §1.2/§4.1 EPOCH_RESET (Stage 3): a fresh script injection is itself always a fresh identity
  // map (a new JS realm — there is nothing stale to clear here, unlike mid-realm `bumpGeneration()`),
  // but it must still *report* the generation the orchestrator says this navigation is, so the
  // resync frame built below knows whether to announce a new epoch to the client.
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

  // Must start observing before anything else touches the document — a mutation that
  // happens before `start()` is a mutation this producer can never recover (no establish
  // fallback exists to paper over it, per P8 / §4.7). It does NOT mean the table starts
  // accurate (§5.1, corrected): whatever the parser already produced by the time `observe()`
  // actually attaches is invisible to the observer and must be recovered by `resyncVirtual`
  // below, not assumed away.
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
    domNodes,
    telemetry,
  });

  // Stage 4 (frame-protocol-production-completeness), §5.8: the resync *request* travels on the
  // existing control channel, not the binary frame body — `PlaneChannel.Control`, reserved since
  // E-03 and unused until now (`PlaneFrameTransport` only ever sends on `PlaneChannel.Frame`, never
  // claims the inbound handler). Mid-session recovery uses `emitResyncFrame` alone, not
  // `resyncVirtual` — the existing identity map's *shape* is trusted, so this re-describes current
  // truth straight from it rather than paying for a full synchronous DOM walk on every recovery.
  // The client-supplied `generation`/`sequence` are diagnostic-only: `emitResyncFrame` always
  // re-describes the map's current truth regardless of what the client last had, and a request that
  // raced a navigation the client hasn't heard about yet is resolved by the client's own
  // generation-mismatch handling (`client/labProjectionClient.ts`) once the response arrives, not by
  // anything read here.
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
      frameEmitter.requestResync((seq) => emitResyncFrame(domNodes, table, domNodes.generation, seq));
    });
  }

  // §5.1/§5.8 bootstrap: one synchronous walk closes the gap between "observer attached" and
  // "parser already ran ahead of it". Whatever the observer buffered up to this same point is
  // redundant with what the walk just captured wholesale, so it is discarded, not built into a
  // frame — the ordinary tick path only ever sees mutations that happen *after* this line.
  const resyncFrame = resyncVirtual(domNodes, table, frameEmitter.currentSequence + 1);
  // §7 ordering rule 1 ("EPOCH_RESET first, if present") — table state is already correct here
  // (`resyncVirtual`/`emitResyncFrame` already reset+rebuilt `table` above; EPOCH_RESET's own
  // `Table` effect, §4.1, is a clear-then-empty that a fresh rebuild already equals), this only
  // adds the wire-level announcement so the client knows to discard its old generation's surface
  // (§6, `client/applyDom.ts`) instead of treating this as an ordinary same-generation resync.
  if (config.generation > 1) {
    resyncFrame.ops.unshift({ op: OpCode.EpochReset, generation: config.generation });
  }
  mutationBuffer.drain();
  await frameEmitter.sendInitial(resyncFrame);

  frameEmitter.start();
  telemetry.start();

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
  };
})();
