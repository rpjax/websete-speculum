/**
 * PageProjection input dispatch — A/B/C (input-v2 2026-08-23).
 * A: CDP fire-and-forget. B: Control → Virtual.domNodes. C: setFiles CDP resolve only.
 */

import type { Page } from 'patchright';
import {
  DomElementInput,
  type DomElementInputOutcome,
  type DomElementInputPipelineMetrics,
  type DomElementInputLatencyStats,
} from '../../../patchright/mirror/dom/DomElementInput';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';
import {
  type DomInputIngress,
  normalizeDomInput,
  type PageProjectionIntentV2,
} from '@speculum/page-projection/core/input/intentTypes';
import { createVirtualTargetResolver, findFrameForContext } from './resolveVirtualNode';

const MODE_B = new Set(['scrollelement', 'focus', 'blur', 'input']);
const LATENCY_SAMPLES = 256;

export type InputDispatchMode = 'A' | 'B' | 'C';

type ResolveHit = {
  ok: boolean;
  reason?: string;
  id?: number;
  generation?: number;
  x?: number;
  y?: number;
};

export type PageProjectionInputDispatchOptions = {
  /** Mode B — same Control plane as requestResync. */
  sendControl?: (message: Record<string, unknown>) => void;
};

export type ModePipelineMetrics = {
  received: number;
  dispatched: number;
  dropped: number;
  dropsByReason: Record<string, number>;
  byType: Record<string, { received: number; dispatched: number; dropped: number }>;
  dispatchMs: DomElementInputLatencyStats;
};

export type PageProjectionInputPipelineMetrics = {
  ingressReceived: number;
  ingressDropped: number;
  ingressDropsByReason: Record<string, number>;
  byMode: {
    A: ModePipelineMetrics;
    B: ModePipelineMetrics;
    C: ModePipelineMetrics;
  };
  /** Sidecar receive wall − intent.wallClientMs (when present). */
  clientLagMs: DomElementInputLatencyStats;
  inject: DomElementInputPipelineMetrics;
  lastOutcome: {
    t: number;
    type: string;
    mode: InputDispatchMode;
    status: 'dispatched' | 'dropped';
    reason?: string;
    dispatchMs?: number;
    clientLagMs?: number;
  } | null;
};

type ModeBucket = {
  received: number;
  dispatched: number;
  dropped: number;
  dropsByReason: Record<string, number>;
  byType: Record<string, { received: number; dispatched: number; dropped: number }>;
  dispatchSamples: number[];
};

function emptyMode(): ModeBucket {
  return {
    received: 0,
    dispatched: 0,
    dropped: 0,
    dropsByReason: {},
    byType: {},
    dispatchSamples: [],
  };
}

function latencyStats(samples: readonly number[]): DomElementInputLatencyStats {
  if (samples.length === 0) return { count: 0, min: 0, avg: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
  return {
    count: sorted.length,
    min: sorted[0]!,
    avg: sum / sorted.length,
    p95: sorted[p95Idx]!,
    max: sorted[sorted.length - 1]!,
  };
}

function snapshotMode(b: ModeBucket): ModePipelineMetrics {
  return {
    received: b.received,
    dispatched: b.dispatched,
    dropped: b.dropped,
    dropsByReason: { ...b.dropsByReason },
    byType: Object.fromEntries(Object.entries(b.byType).map(([k, v]) => [k, { ...v }])),
    dispatchMs: latencyStats(b.dispatchSamples),
  };
}

export function classifyInputMode(type: string): InputDispatchMode {
  const t = type.trim().toLowerCase();
  if (t === 'setfiles') return 'C';
  if (MODE_B.has(t)) return 'B';
  return 'A';
}

export class PageProjectionInputDispatch {
  private readonly domInput: DomElementInput;
  private readonly sendControl: ((message: Record<string, unknown>) => void) | null;
  private readonly resolver: ReturnType<typeof createVirtualTargetResolver>;
  private ingressReceived = 0;
  private ingressDropped = 0;
  private readonly ingressDropsByReason: Record<string, number> = {};
  private readonly modes: Record<InputDispatchMode, ModeBucket> = {
    A: emptyMode(),
    B: emptyMode(),
    C: emptyMode(),
  };
  private readonly clientLagSamples: number[] = [];
  private lastOutcome: PageProjectionInputPipelineMetrics['lastOutcome'] = null;

  constructor(
    private readonly page: Page,
    opts?: PageProjectionInputDispatchOptions,
  ) {
    this.sendControl = opts?.sendControl ?? null;
    this.resolver = createVirtualTargetResolver(page);
    this.domInput = new DomElementInput(
      page,
      { takeUpload: () => undefined },
      {
        resolveTarget: (targetId, contextId) =>
          this.resolver.resolve(targetId, contextId ?? CONTEXT_ID_ROOT),
      },
    );
  }

  getPipelineMetrics(): PageProjectionInputPipelineMetrics {
    return {
      ingressReceived: this.ingressReceived,
      ingressDropped: this.ingressDropped,
      ingressDropsByReason: { ...this.ingressDropsByReason },
      byMode: {
        A: snapshotMode(this.modes.A),
        B: snapshotMode(this.modes.B),
        C: snapshotMode(this.modes.C),
      },
      clientLagMs: latencyStats(this.clientLagSamples),
      inject: this.domInput.getMetrics(),
      lastOutcome: this.lastOutcome,
    };
  }

  async dispatchIntent(intent: PageProjectionIntentV2): Promise<DomElementInputOutcome> {
    const receivedAt = Date.now();
    this.ingressReceived += 1;
    const type = intent.type.trim().toLowerCase();
    const mode = classifyInputMode(type);
    const bucket = this.modes[mode];
    bucket.received += 1;
    let row = bucket.byType[type];
    if (!row) {
      row = { received: 0, dispatched: 0, dropped: 0 };
      bucket.byType[type] = row;
    }
    row.received += 1;

    let clientLagMs: number | undefined;
    if (typeof intent.wallClientMs === 'number' && Number.isFinite(intent.wallClientMs)) {
      const lag = receivedAt - intent.wallClientMs;
      if (lag >= 0 && lag < 60_000) {
        clientLagMs = lag;
        this.clientLagSamples.push(lag);
        if (this.clientLagSamples.length > LATENCY_SAMPLES) this.clientLagSamples.shift();
      }
    }

    const started = Date.now();
    let outcome: DomElementInputOutcome;

    if (mode === 'B') {
      if (intent.nodeId == null || intent.nodeId <= 0) {
        outcome = { status: 'dropped', reason: 'node_id_required' };
      } else if (!this.sendControl) {
        outcome = { status: 'dropped', reason: 'control_unavailable' };
      } else {
        this.sendControl({
          type: 'input',
          contextId: intent.contextId > 0 ? intent.contextId : CONTEXT_ID_ROOT,
          intentType: type,
          nodeId: intent.nodeId,
          payload: intent.payload,
        });
        outcome = { status: 'dispatched' };
      }
    } else {
      // Mode A (+ C setFiles): CDP. No nested frame map — client sends root viewport coords.
      outcome = await this.domInput.dispatch({
        type: intent.type,
        targetId: mode === 'C' ? intent.nodeId : null,
        contextId: intent.contextId,
        generation: intent.generation,
        timestampClient: intent.timestampClient,
        payloadJson: intent.payload,
      });
    }

    const dispatchMs = Date.now() - started;
    bucket.dispatchSamples.push(dispatchMs);
    if (bucket.dispatchSamples.length > LATENCY_SAMPLES) bucket.dispatchSamples.shift();

    if (outcome.status === 'dropped') {
      this.noteIngressDrop(outcome.reason);
      bucket.dropped += 1;
      row.dropped += 1;
      bucket.dropsByReason[outcome.reason] = (bucket.dropsByReason[outcome.reason] ?? 0) + 1;
      this.lastOutcome = {
        t: Date.now(),
        type,
        mode,
        status: 'dropped',
        reason: outcome.reason,
        dispatchMs,
        clientLagMs,
      };
    } else {
      bucket.dispatched += 1;
      row.dispatched += 1;
      this.lastOutcome = {
        t: Date.now(),
        type,
        mode,
        status: 'dispatched',
        dispatchMs,
        clientLagMs,
      };
    }
    return outcome;
  }

  private noteIngressDrop(reason: string): void {
    this.ingressDropped += 1;
    this.ingressDropsByReason[reason] = (this.ingressDropsByReason[reason] ?? 0) + 1;
  }

  async dispatchIngress(input: DomInputIngress): Promise<DomElementInputOutcome> {
    const intent = normalizeDomInput(input);
    return this.dispatchIntent(intent);
  }

  /** Lab blueprint helper — one-shot query for coords, then Mode A CDP. Not the live hot path. */
  private async resolveInContext(
    selector: string,
    contextId: number,
    mode: 'id' | 'click',
  ): Promise<ResolveHit> {
    const frame = await findFrameForContext(this.page, contextId);
    if (!frame) return { ok: false, reason: 'context_frame_missing' };
    try {
      const argsJson = JSON.stringify({ sel: selector, click: mode === 'click' });
      const hit = await frame.evaluate(
        `((args) => {
          const p = globalThis.__speculumProjection;
          if (!p || !p.domNodes) return { ok: false, reason: 'producer' };
          const el = document.querySelector(args.sel);
          if (!el) return { ok: false, reason: 'missing_element' };
          const id = p.domNodes.keyOf(el);
          if (!id || id <= 0) return { ok: false, reason: 'no_node_id' };
          if (!args.click) return { ok: true, id, generation: p.domNodes.generation };
          const rect = el.getBoundingClientRect();
          return {
            ok: true,
            id,
            generation: p.domNodes.generation,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        })(${argsJson})`,
      );
      if (!hit || typeof hit !== 'object' || !('ok' in (hit as object))) {
        return { ok: false, reason: 'evaluate_empty' };
      }
      return hit as ResolveHit;
    } catch {
      return { ok: false, reason: 'evaluate_failed' };
    }
  }

  async resolveAndClick(
    selector: string,
    contextId: number = CONTEXT_ID_ROOT,
  ): Promise<DomElementInputOutcome> {
    const info = await this.resolveInContext(selector, contextId, 'click');
    if (!info.ok || !info.id || info.x == null || info.y == null) {
      return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
    }
    // Nested blueprint: map frame-local center to page for CDP (harness only).
    let x = info.x;
    let y = info.y;
    if (contextId !== CONTEXT_ID_ROOT) {
      const frame = await findFrameForContext(this.page, contextId);
      if (frame) {
        try {
          const frameEl = await frame.frameElement();
          const box = frameEl ? await frameEl.boundingBox() : null;
          if (box) {
            x = box.x + x;
            y = box.y + y;
          }
        } catch {
          /* keep frame-local */
        }
      }
    }
    const payloadJson = JSON.stringify({
      x,
      y,
      button: 0,
      buttons: 0,
      modifiers: {},
    });
    const base: DomInputIngress = {
      generation: info.generation ?? 0,
      targetId: null,
      contextId: CONTEXT_ID_ROOT,
      payloadJson,
      timestampClient: Date.now(),
      wallClientMs: Date.now(),
      type: 'mousemove',
    };
    for (const type of ['mousemove', 'mousedown', 'mouseup'] as const) {
      const out = await this.dispatchIngress({ ...base, type });
      if (out.status === 'dropped') return out;
    }
    return { status: 'dispatched' };
  }

  async resolveAndType(
    selector: string,
    value: string,
    contextId: number = CONTEXT_ID_ROOT,
  ): Promise<DomElementInputOutcome> {
    const info = await this.resolveInContext(selector, contextId, 'id');
    if (!info.ok || !info.id) {
      return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
    }
    return this.dispatchIngress({
      type: 'input',
      targetId: info.id,
      contextId,
      generation: info.generation ?? 0,
      payloadJson: JSON.stringify({ value }),
      timestampClient: Date.now(),
      wallClientMs: Date.now(),
    });
  }

  async resolveAndScrollElement(
    selector: string,
    scrollTop: number,
    contextId: number = CONTEXT_ID_ROOT,
  ): Promise<DomElementInputOutcome> {
    const info = await this.resolveInContext(selector, contextId, 'id');
    if (!info.ok || !info.id) {
      return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
    }
    return this.dispatchIngress({
      type: 'scrollElement',
      targetId: info.id,
      contextId,
      generation: info.generation ?? 0,
      payloadJson: JSON.stringify({ scrollTop, scrollLeft: 0 }),
      timestampClient: Date.now(),
      wallClientMs: Date.now(),
    });
  }

  async resolveAndScrollViewport(
    scrollY: number,
    scrollX: number = 0,
    contextId: number = CONTEXT_ID_ROOT,
  ): Promise<DomElementInputOutcome> {
    return this.dispatchIngress({
      type: 'scrollViewport',
      targetId: null,
      contextId,
      generation: 0,
      payloadJson: JSON.stringify({ scrollX, scrollY }),
      timestampClient: Date.now(),
      wallClientMs: Date.now(),
    });
  }
}
