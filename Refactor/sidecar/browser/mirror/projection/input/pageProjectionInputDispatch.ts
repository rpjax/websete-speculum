/**
 * PageProjection input dispatch — serial CDP chain via DomElementInput.
 * No generation sync with the frame plane: resolve nodeId when required → CDP.
 */

import type { Page } from 'patchright';
import {
  DomElementInput,
  type DomElementInputOutcome,
  type DomElementInputPipelineMetrics,
} from '../../../patchright/mirror/dom/DomElementInput';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';
import {
  type DomInputIngress,
  normalizeDomInput,
  type PageProjectionIntentV2,
} from '@speculum/page-projection/core/input/intentTypes';
import { createVirtualTargetResolver, findFrameForContext } from './resolveVirtualNode';

type ResolveHit = {
  ok: boolean;
  reason?: string;
  id?: number;
  generation?: number;
  x?: number;
  y?: number;
};

export type PageProjectionInputPipelineMetrics = {
  ingressReceived: number;
  ingressDropped: number;
  ingressDropsByReason: Record<string, number>;
  inject: DomElementInputPipelineMetrics;
};

export class PageProjectionInputDispatch {
  private readonly domInput: DomElementInput;
  private ingressReceived = 0;
  private ingressDropped = 0;
  private readonly ingressDropsByReason: Record<string, number> = {};

  constructor(private readonly page: Page) {
    const resolver = createVirtualTargetResolver(page);
    this.domInput = new DomElementInput(
      page,
      { takeUpload: () => undefined },
      {
        resolveTarget: (targetId, contextId) =>
          resolver.resolve(targetId, contextId ?? CONTEXT_ID_ROOT),
      },
    );
  }

  getPipelineMetrics(): PageProjectionInputPipelineMetrics {
    return {
      ingressReceived: this.ingressReceived,
      ingressDropped: this.ingressDropped,
      ingressDropsByReason: { ...this.ingressDropsByReason },
      inject: this.domInput.getMetrics(),
    };
  }

  async dispatchIntent(intent: PageProjectionIntentV2): Promise<DomElementInputOutcome> {
    this.ingressReceived += 1;
    const type = intent.type.trim().toLowerCase();
    let payloadJson = intent.payload;
    const needsPageCoords =
      intent.contextId !== CONTEXT_ID_ROOT
      && (type === 'mousemove'
        || type === 'mousedown'
        || type === 'mouseup'
        || type === 'pointermove'
        || type === 'pointerdown'
        || type === 'pointerup'
        || type === 'wheel');
    if (needsPageCoords) {
      const mapped = await this.mapNestedPayloadToPage(intent.contextId, payloadJson);
      if (mapped == null) {
        this.noteIngressDrop('frame_box_missing');
        return { status: 'dropped', reason: 'frame_box_missing' };
      }
      payloadJson = mapped;
    }
    return this.domInput.dispatch({
      type: intent.type,
      targetId: intent.nodeId,
      contextId: intent.contextId,
      generation: intent.generation,
      timestampClient: intent.timestampClient,
      payloadJson,
    });
  }

  private noteIngressDrop(reason: string): void {
    this.ingressDropped += 1;
    this.ingressDropsByReason[reason] = (this.ingressDropsByReason[reason] ?? 0) + 1;
  }

  async dispatchIngress(input: DomInputIngress): Promise<DomElementInputOutcome> {
    const intent = normalizeDomInput(input);
    return this.dispatchIntent(intent);
  }

  /** Nested capture sends viewport-local coords; CDP mouse needs page coords. */
  private async mapNestedPayloadToPage(contextId: number, payloadJson: string): Promise<string | null> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadJson) as Record<string, unknown>;
    } catch {
      return null;
    }
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return payloadJson;
    const frame = await findFrameForContext(this.page, contextId);
    const pagePt = await this.pageCoordsForFramePoint(frame, contextId, x, y);
    if (!pagePt) return null;
    return JSON.stringify({ ...payload, x: pagePt.x, y: pagePt.y });
  }

  private async pageCoordsForFramePoint(
    frame: Awaited<ReturnType<typeof findFrameForContext>>,
    contextId: number,
    x: number,
    y: number,
  ): Promise<{ x: number; y: number } | null> {
    if (!frame || contextId === CONTEXT_ID_ROOT) return { x, y };
    try {
      const frameEl = await frame.frameElement();
      const box = frameEl ? await frameEl.boundingBox() : null;
      if (!box) return null;
      return { x: box.x + x, y: box.y + y };
    } catch {
      return null;
    }
  }

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
      // Frame-local coords — dispatchIntent maps nested → page for CDP mouse.
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
    const payloadJson = JSON.stringify({
      x: info.x,
      y: info.y,
      button: 0,
      buttons: 0,
      modifiers: {},
    });
    const base: DomInputIngress = {
      generation: info.generation ?? 0,
      targetId: info.id,
      contextId,
      payloadJson,
      timestampClient: Date.now(),
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
    });
  }
}
