import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CDPSession, ElementHandle, Page } from 'patchright';

/**
 * Minimal surface `DomElementInput` needs from a PageProjection host. Both
 * Legacy Dom element input (video path unused; PP uses sealed inputDispatch).
 * structurally satisfy this without a shared base type.
 */
export type DomProjectionInputHost = {
  takeUpload(id: string): { body: Buffer; contentType: string; name: string } | undefined;
};

export type DomElementInputEvent = {
  type: string;
  /** @deprecated Prefer targetId (redesign §5.11). Kept for V1 transition. */
  anchor?: string | null;
  /** Redesign §5.11 — uint32 id resolved via IdentitySpace reverse map. */
  targetId?: number | null;
  /** V4 multi-document — resolve in the producer context carrying this id. */
  contextId?: number;
  generation?: number;
  timestampClient?: number | null;
  payloadJson?: string;
};

export type DomElementInputOptions = {
  /** V4 adapter — when set, used before legacy __speculumPageProjectionV2 resolve. */
  resolveTarget?: (targetId: number, contextId?: number) => Promise<ElementHandle | null>;
};

export type DomElementInputOutcome =
  | { status: 'dispatched' }
  | { status: 'dropped'; reason: string };

export type DomElementInputLatencyStats = {
  count: number;
  min: number;
  avg: number;
  p95: number;
  max: number;
};

export type DomElementInputPipelineMetrics = {
  received: number;
  dispatched: number;
  dropped: number;
  dropsByReason: Record<string, number>;
  byType: Record<string, { received: number; dispatched: number; dropped: number }>;
  chainDepthCurrent: number;
  chainDepthPeak: number;
  moveCollapseCount: number;
  moveHeldUnderDepth: number;
  pendingMove: boolean;
  moveFlushEnqueued: boolean;
  queueWaitMs: DomElementInputLatencyStats;
  injectMs: DomElementInputLatencyStats;
  lastOutcome: {
    t: number;
    type: string;
    status: 'dispatched' | 'dropped';
    reason?: string;
  } | null;
};

type IntentPayload = {
  x?: number;
  y?: number;
  button?: number;
  buttons?: number;
  modifiers?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean };
  pointerType?: string;
  pointerId?: number;
  pressure?: number;
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  key?: string;
  code?: string;
  repeat?: boolean;
  location?: number;
  value?: string;
  checked?: boolean;
  scrollTop?: number;
  scrollLeft?: number;
  scrollX?: number;
  scrollY?: number;
  files?: Array<{
    uploadId?: string | null;
    name: string;
    type?: string;
    lastModified?: number | null;
    size?: number;
    bytesBase64?: string | null;
  }>;
};

/**
 * Dom Projection CDP-only inject chain. Isolated from OsInputBackend.
 * No wire `click` — gesture is mouseMoved → mousePressed → mouseReleased,
 * or touchMove → touchStart → touchEnd when intent `pointerType` is `touch`.
 */
export class DomElementInput {
  /** §6.4 defaults — collapse moves under inject-chain pressure. */
  private static readonly INJECT_CHAIN_MAX_DEPTH = 64;
  private static readonly INJECT_MOVE_COLLAPSE_AGE_MS = 50;
  private static readonly LATENCY_SAMPLES = 256;

  private chain: Promise<void> = Promise.resolve();
  private chainDepth = 0;
  private lastMove: { x: number; y: number } | null = null;
  private pendingMove: { x: number; y: number; touch: boolean; pointerId: number } | null = null;
  private pendingMoveAtMs = 0;
  /** At most one move-flush task on the inject chain (§6.4 coalesce). */
  private moveFlushEnqueued = false;
  /** Active touch contact (Mode A touch path) — moves are touchMove only while down. */
  private touchActive = false;
  private touchPointerId = 1;
  private cdp: CDPSession | null = null;

  /** Keys that used insertText on keydown — skip matching keyup. */
  private insertTextKeys = new Set<string>();

  private received = 0;
  private dispatched = 0;
  private dropped = 0;
  private readonly dropsByReason: Record<string, number> = {};
  private readonly byType: Record<string, { received: number; dispatched: number; dropped: number }> = {};
  private chainDepthPeak = 0;
  private moveCollapseCount = 0;
  private moveHeldUnderDepth = 0;
  private readonly queueWaitSamples: number[] = [];
  private readonly injectSamples: number[] = [];
  private lastOutcome: DomElementInputPipelineMetrics['lastOutcome'] = null;

  constructor(
    private readonly page: Page,
    private readonly projection?: DomProjectionInputHost,
    private readonly options?: DomElementInputOptions,
  ) {}

  getMetrics(): DomElementInputPipelineMetrics {
    return {
      received: this.received,
      dispatched: this.dispatched,
      dropped: this.dropped,
      dropsByReason: { ...this.dropsByReason },
      byType: Object.fromEntries(
        Object.entries(this.byType).map(([k, v]) => [k, { ...v }]),
      ),
      chainDepthCurrent: this.chainDepth,
      chainDepthPeak: this.chainDepthPeak,
      moveCollapseCount: this.moveCollapseCount,
      moveHeldUnderDepth: this.moveHeldUnderDepth,
      pendingMove: this.pendingMove != null,
      moveFlushEnqueued: this.moveFlushEnqueued,
      queueWaitMs: latencyStats(this.queueWaitSamples),
      injectMs: latencyStats(this.injectSamples),
      lastOutcome: this.lastOutcome,
    };
  }

  async dispatch(event: DomElementInputEvent): Promise<DomElementInputOutcome> {
    const type = event.type.trim().toLowerCase();
    const enqueuedAt = Date.now();

    // Coalesce moves: update latest sample; enqueue at most one flush (§6.4).
    // Presses/keys never sit behind a backlog of N move chain tasks.
    if (type === 'mousemove' || type === 'pointermove') {
      const payload = parsePayload(event.payloadJson);
      if (!this.acceptMove(payload)) {
        return this.finish(type, { status: 'dropped', reason: 'invalid_coords' });
      }
      // Under depth/age pressure: keep latest sample only — never deepen the chain
      // with another move-flush task (hard rule: collapse moves, never drop presses).
      const aged =
        this.pendingMoveAtMs > 0
        && Date.now() - this.pendingMoveAtMs >= DomElementInput.INJECT_MOVE_COLLAPSE_AGE_MS;
      if (
        this.moveFlushEnqueued
        || this.chainDepth >= DomElementInput.INJECT_CHAIN_MAX_DEPTH
        || aged
      ) {
        if (!this.moveFlushEnqueued && this.chainDepth >= DomElementInput.INJECT_CHAIN_MAX_DEPTH) {
          // Depth already saturated with protected work — sample is held in pendingMove
          // and will flush before the next protected intent via flushMove().
          this.moveHeldUnderDepth += 1;
          return this.finish(type, { status: 'dispatched' });
        }
        if (this.moveFlushEnqueued) {
          this.moveCollapseCount += 1;
          return this.finish(type, { status: 'dispatched' });
        }
        if (aged) this.moveCollapseCount += 1;
      }
      if (!this.moveFlushEnqueued) {
        this.moveFlushEnqueued = true;
        this.chainDepth += 1;
        this.noteDepthPeak();
        let flushOutcome: DomElementInputOutcome = { status: 'dispatched' };
        const flush = this.chain.then(async () => {
          this.moveFlushEnqueued = false;
          this.pushSample(this.queueWaitSamples, Date.now() - enqueuedAt);
          const injectStarted = Date.now();
          try {
            await this.flushMove();
          } catch {
            flushOutcome = { status: 'dropped', reason: 'cdp_error' };
          } finally {
            this.pushSample(this.injectSamples, Date.now() - injectStarted);
            this.chainDepth = Math.max(0, this.chainDepth - 1);
          }
        });
        this.chain = flush;
        await flush;
        return this.finish(type, flushOutcome);
      }
      this.moveCollapseCount += 1;
      return this.finish(type, { status: 'dispatched' });
    }

    let outcome: DomElementInputOutcome = { status: 'dispatched' };
    this.chainDepth += 1;
    this.noteDepthPeak();
    const run = async () => {
      this.pushSample(this.queueWaitSamples, Date.now() - enqueuedAt);
      const injectStarted = Date.now();
      try {
        outcome = await this.dispatchNow(event);
      } catch {
        outcome = { status: 'dropped', reason: 'cdp_error' };
      } finally {
        this.pushSample(this.injectSamples, Date.now() - injectStarted);
        this.chainDepth = Math.max(0, this.chainDepth - 1);
      }
    };

    this.chain = this.chain.then(run, run);
    await this.chain;
    return this.finish(type, outcome);
  }

  private finish(type: string, outcome: DomElementInputOutcome): DomElementInputOutcome {
    this.received += 1;
    let row = this.byType[type];
    if (!row) {
      row = { received: 0, dispatched: 0, dropped: 0 };
      this.byType[type] = row;
    }
    row.received += 1;
    if (outcome.status === 'dropped') {
      this.dropped += 1;
      row.dropped += 1;
      this.dropsByReason[outcome.reason] = (this.dropsByReason[outcome.reason] ?? 0) + 1;
      this.lastOutcome = { t: Date.now(), type, status: 'dropped', reason: outcome.reason };
    } else {
      this.dispatched += 1;
      row.dispatched += 1;
      this.lastOutcome = { t: Date.now(), type, status: 'dispatched' };
    }
    return outcome;
  }

  private noteDepthPeak(): void {
    if (this.chainDepth > this.chainDepthPeak) this.chainDepthPeak = this.chainDepth;
  }

  private pushSample(bucket: number[], value: number): void {
    bucket.push(value);
    if (bucket.length > DomElementInput.LATENCY_SAMPLES) bucket.shift();
  }

  private async dispatchNow(event: DomElementInputEvent): Promise<DomElementInputOutcome> {
    const type = event.type.trim().toLowerCase();
    if (type === 'resync') {
      // I2: there is no input intent named resync — OOB PageProjection.Resync only.
      return { status: 'dropped', reason: 'resync_not_an_intent' };
    }
    // Never honor wire click — would double-fire with pressed/released.
    if (type === 'click' || type === 'auxclick') {
      return { status: 'dropped', reason: 'ignored_wire_click' };
    }

    const payload = parsePayload(event.payloadJson);
    if (type === 'mousemove' || type === 'pointermove') {
      if (!this.acceptMove(payload)) {
        return { status: 'dropped', reason: 'invalid_coords' };
      }
      // Flush on the input chain (not a detached microtask) so CDP failures become CdpDropped.
      await this.flushMove();
      return { status: 'dispatched' };
    }

    await this.flushMove();

    if (type === 'mousedown' || type === 'pointerdown') {
      const reason = isTouchPointer(payload)
        ? await this.dispatchTouch('touchStart', payload)
        : await this.dispatchMouse('mousePressed', payload);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'mouseup' || type === 'pointerup') {
      const reason = isTouchPointer(payload)
        ? await this.dispatchTouch('touchEnd', payload)
        : await this.dispatchMouse('mouseReleased', payload);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'wheel') {
      await this.dispatchWheel(payload);
      return { status: 'dispatched' };
    }
    if (type === 'keydown' || type === 'keyup') {
      const reason = await this.dispatchKey(type, event.anchor, payload, event.targetId, event.contextId);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    // Mode B (scrollElement / focus / blur / input) is Control → Virtual.domNodes — not CDP here.
    if (
      type === 'input'
      || type === 'scrollelement'
      || type === 'focus'
      || type === 'blur'
    ) {
      return { status: 'dropped', reason: 'mode_b_via_control' };
    }
    if (type === 'setfiles') {
      const reason = await this.dispatchSetFiles(event.anchor, payload, event.targetId, event.contextId);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'scrollviewport') {
      await this.dispatchScrollViewport(payload);
      return { status: 'dispatched' };
    }
    return { status: 'dropped', reason: 'unknown_type' };
  }

  /** Queue latest move coords. Returns false when payload coords are invalid. */
  private acceptMove(payload: IntentPayload): boolean {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.pendingMove = {
      x,
      y,
      touch: isTouchPointer(payload),
      pointerId: touchPointerId(payload),
    };
    this.pendingMoveAtMs = Date.now();
    return true;
  }

  private async flushMove(): Promise<void> {
    const next = this.pendingMove;
    this.pendingMove = null;
    this.pendingMoveAtMs = 0;
    if (!next) return;
    if (this.lastMove && this.lastMove.x === next.x && this.lastMove.y === next.y) return;
    if (next.touch) {
      // Finger move without an active contact is not a hover — drop (sites must not see mouseover).
      if (!this.touchActive) return;
      this.lastMove = { x: next.x, y: next.y };
      await this.sendTouch('touchMove', next.x, next.y, next.pointerId);
      return;
    }
    this.lastMove = { x: next.x, y: next.y };
    await this.page.mouse.move(next.x, next.y);
  }

  /**
   * Mode A press/release: CDP at payload viewport coords. No resolve / boundingBox.
   * Miss or wrong target = expected under fire-and-forget.
   */
  private async dispatchMouse(
    type: 'mousePressed' | 'mouseReleased',
    payload: IntentPayload,
  ): Promise<string | null> {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'invalid_coords';
    const button = mouseButtonName(payload.button);
    await this.page.mouse.move(x, y);
    this.lastMove = { x, y };
    if (type === 'mousePressed') {
      await this.page.mouse.down({ button });
    } else {
      await this.page.mouse.up({ button });
    }
    return null;
  }

  /** Mode A touch — CDP `Input.dispatchTouchEvent` (same path as PatchrightInputBackend.touch). */
  private async dispatchTouch(
    type: 'touchStart' | 'touchEnd',
    payload: IntentPayload,
  ): Promise<string | null> {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'invalid_coords';
    const id = touchPointerId(payload);
    if (type === 'touchStart') {
      this.touchActive = true;
      this.touchPointerId = id;
      this.lastMove = { x, y };
      await this.sendTouch('touchStart', x, y, id);
      return null;
    }
    // Release: empty touchPoints ends the contact (CDP convention).
    this.touchActive = false;
    this.lastMove = { x, y };
    await this.sendTouch('touchEnd', x, y, id);
    return null;
  }

  private async sendTouch(
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    x: number,
    y: number,
    id: number,
  ): Promise<void> {
    const cdp = await this.ensureCdp();
    if (type === 'touchEnd') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return;
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [{ x, y, id }],
    });
  }

  private async ensureCdp(): Promise<CDPSession> {
    if (this.cdp) return this.cdp;
    this.cdp = await this.page.context().newCDPSession(this.page);
    return this.cdp;
  }

  private async dispatchWheel(payload: IntentPayload): Promise<void> {
    const x = Number(payload.x);
    const y = Number(payload.y);
    const deltaX = Number(payload.deltaX ?? 0);
    const deltaY = Number(payload.deltaY ?? 0);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await this.page.mouse.move(x, y);
      this.lastMove = { x, y };
    }
    await this.page.mouse.wheel(deltaX, deltaY);
  }

  /** Mode A key — CDP to current focus. For non-text keys with nodeId, focus that element first. */
  private async dispatchKey(
    type: 'keydown' | 'keyup',
    _anchor: string | null | undefined,
    payload: IntentPayload,
    targetId?: number | null,
    contextId?: number,
  ): Promise<string | null> {
    const key = typeof payload.key === 'string' ? payload.key : '';
    if (!key) return 'empty_key';
    if (type === 'keydown') {
      const mods = payload.modifiers;
      const hasMod = !!(mods?.alt || mods?.ctrl || mods?.meta);
      const insertText = !hasMod && key.length === 1 && !payload.repeat;
      // Enter / Tab / arrows / chords need focus on the target. Plain typing uses insertText.
      if (!insertText && targetId != null && targetId > 0) {
        const el = await this.resolveElement(null, targetId, contextId);
        if (el) {
          try {
            await el.focus();
          } catch {
            /* ignore */
          } finally {
            await el.dispose().catch(() => undefined);
          }
        }
      }
      if (insertText) {
        await this.page.keyboard.insertText(key);
        this.insertTextKeys.add(key);
        return null;
      }
      await this.page.keyboard.down(key);
    } else {
      if (this.insertTextKeys.has(key)) {
        this.insertTextKeys.delete(key);
        return null;
      }
      await this.page.keyboard.up(key);
    }
    return null;
  }

  private async dispatchSetFiles(
    anchor: string | null | undefined,
    payload: IntentPayload,
    targetId?: number | null,
    contextId?: number,
  ): Promise<string | null> {
    const el = await this.resolveElement(anchor, targetId, contextId);
    if (!el) return 'anchor_missing';
    if (!payload.files?.length) {
      await el.dispose().catch(() => undefined);
      return 'empty_files';
    }
    const paths: string[] = [];
    try {
      for (const file of payload.files) {
        let body: Buffer | null = null;
        if (file.uploadId && this.projection) {
          const u = this.projection.takeUpload(file.uploadId);
          if (u) body = u.body;
        }
        if (!body && file.bytesBase64) {
          body = Buffer.from(file.bytesBase64, 'base64');
        }
        if (!body) continue;
        const path = join(tmpdir(), `speculum-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await fs.writeFile(path, body);
        paths.push(path);
      }
      if (!paths.length) return 'empty_files';
      await el.setInputFiles(paths);
      return null;
    } finally {
      await el.dispose().catch(() => undefined);
      for (const p of paths) {
        await fs.unlink(p).catch(() => undefined);
      }
    }
  }

  /** Viewport scroller — absolute page position, no anchor. */
  private async dispatchScrollViewport(payload: IntentPayload): Promise<void> {
    const x = Number(payload.scrollX ?? 0);
    const y = Number(payload.scrollY ?? 0);
    await this.page.evaluate(
      ({ x: left, y: top }) => {
        const g = globalThis as typeof globalThis & {
          __speculumDomNoteScrollEcho?: (n: unknown) => void;
          __speculumDomConsumeScrollEchoIfAt?: (n: unknown) => boolean;
          top?: {
            __speculumDomNoteScrollEcho?: (n: unknown) => void;
            __speculumDomConsumeScrollEchoIfAt?: (n: unknown) => boolean;
          };
          scrollTo: (x: number, y: number) => void;
          scrollX: number;
          scrollY: number;
        };
        const note = g.__speculumDomNoteScrollEcho ?? g.top?.__speculumDomNoteScrollEcho;
        const consume =
          g.__speculumDomConsumeScrollEchoIfAt ?? g.top?.__speculumDomConsumeScrollEchoIfAt;
        const mark = { viewport: { x: left, y: top } };
        // Contract: note before mutate so sync scroll sensors see the echo mark.
        note?.(mark);
        const beforeX = g.scrollX || 0;
        const beforeY = g.scrollY || 0;
        g.scrollTo(left, top);
        const afterX = g.scrollX || 0;
        const afterY = g.scrollY || 0;
        // True no-op (no scroll event): consume mark. If position moved, leave
        // mark for the scroll sensor (do not race async delivery).
        if (
          beforeX === afterX
          && beforeY === afterY
          && afterX === left
          && afterY === top
        ) {
          consume?.(mark);
        }
      },
      { x, y },
    );
  }

  /**
   * Pierce-aware resolve (input §6.7 / redesign §5.11):
   * Prefer uint32 targetId via __speculumPageProjectionV2.reverse map;
   * fall back to deprecated speculum-anchor string for V1 transition.
   */
  private async resolveElement(
    anchor: string | null | undefined,
    targetId?: number | null,
    contextId?: number,
  ): Promise<ElementHandle | null> {
    if (targetId && targetId > 0 && this.options?.resolveTarget) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const el = await this.options.resolveTarget(targetId, contextId);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
      }
      // miss → fall through to legacy resolve when anchor present
    }
    if (targetId && targetId > 0) {
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const frame of this.page.frames()) {
          try {
            const handle = await frame.evaluateHandle((id) => {
              const w = globalThis as typeof globalThis & {
                __speculumPageProjectionV2?: { resolve?: (id: number) => unknown };
              };
              return w.__speculumPageProjectionV2?.resolve?.(id) ?? null;
            }, targetId);
            const element = handle.asElement() as ElementHandle | null;
            if (element) return element;
            await handle.dispose().catch(() => undefined);
          } catch {
            /* frame detached */
          }
        }
        await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
      }
      // miss → retry-then-drop (AnchorMiss) — fall through to anchor if present
    }
    if (!anchor) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const frame of this.page.frames()) {
        try {
          const handle = await frame.evaluateHandle((a) => {
            const w = globalThis as typeof globalThis & {
              __speculumDomResolve?: (anchor: string) => unknown;
              CSS?: { escape?: (s: string) => string };
              document?: { querySelector: (q: string) => unknown };
            };
            const resolved = w.__speculumDomResolve?.(a);
            if (resolved) return resolved;
            const esc =
              typeof w.CSS?.escape === 'function'
                ? w.CSS.escape(a)
                : String(a).replace(/["\\]/g, '\\$&');
            return w.document?.querySelector('[speculum-anchor="' + esc + '"]') ?? null;
          }, anchor);
          const element = handle.asElement() as ElementHandle | null;
          if (element) return element;
          await handle.dispose().catch(() => undefined);
        } catch {
          /* frame detached mid-flight */
        }
      }
      await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
    }
    return null;
  }
}

function parsePayload(raw: string | undefined): IntentPayload {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as IntentPayload) : {};
  } catch {
    return {};
  }
}

/** Client `PointerEvent.pointerType === 'touch'` → CDP touch path (not mouse hover). */
function isTouchPointer(payload: IntentPayload): boolean {
  return payload.pointerType === 'touch';
}

function touchPointerId(payload: IntentPayload): number {
  const id = payload.pointerId;
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) return Math.floor(id);
  return 1;
}

function mouseButtonName(button: number | undefined): 'left' | 'middle' | 'right' {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
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
