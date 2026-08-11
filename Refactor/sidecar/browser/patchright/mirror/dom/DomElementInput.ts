import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElementHandle, Page } from 'patchright';

/**
 * Minimal surface `DomElementInput` needs from a PageProjection host. Both
 * V1 `PageProjection` and V2 `LivePageProjection` (mirror/page/liveAttach.ts)
 * structurally satisfy this without a shared base type.
 */
export type DomProjectionInputHost = {
  getGeneration?(): number;
  takeUpload(id: string): { body: Buffer; contentType: string; name: string } | undefined;
};

export type DomElementInputEvent = {
  type: string;
  /** @deprecated Prefer targetId (redesign §5.11). Kept for V1 transition. */
  anchor?: string | null;
  /** Redesign §5.11 — uint32 id resolved via IdentitySpace reverse map. */
  targetId?: number | null;
  generation?: number;
  timestampClient?: number | null;
  payloadJson?: string;
};

export type DomElementInputOutcome =
  | { status: 'dispatched' }
  | { status: 'dropped'; reason: string };

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
 * No wire `click` — gesture is mouseMoved → mousePressed → mouseReleased.
 */
export class DomElementInput {
  /** §6.4 defaults — collapse moves under inject-chain pressure. */
  private static readonly INJECT_CHAIN_MAX_DEPTH = 64;
  private static readonly INJECT_MOVE_COLLAPSE_AGE_MS = 50;

  private chain: Promise<void> = Promise.resolve();
  private chainDepth = 0;
  private lastMove: { x: number; y: number } | null = null;
  private pendingMove: { x: number; y: number } | null = null;
  private pendingMoveAtMs = 0;
  /** At most one move-flush task on the inject chain (§6.4 coalesce). */
  private moveFlushEnqueued = false;

  /** Keys that used insertText on keydown — skip matching keyup. */
  private insertTextKeys = new Set<string>();

  constructor(
    private readonly page: Page,
    private readonly projection?: DomProjectionInputHost,
  ) {}

  async dispatch(event: DomElementInputEvent): Promise<DomElementInputOutcome> {
    const type = event.type.trim().toLowerCase();

    // Coalesce moves: update latest sample; enqueue at most one flush (§6.4).
    // Presses/keys never sit behind a backlog of N move chain tasks.
    if (type === 'mousemove' || type === 'pointermove') {
      const currentGen = this.projection?.getGeneration?.() ?? 0;
      if (
        event.generation != null
        && event.generation > 0
        && currentGen > 0
        && event.generation !== currentGen
      ) {
        return { status: 'dropped', reason: 'generation_stale' };
      }
      const payload = parsePayload(event.payloadJson);
      if (!this.acceptMove(payload)) {
        return { status: 'dropped', reason: 'invalid_coords' };
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
          return { status: 'dispatched' };
        }
        if (this.moveFlushEnqueued) return { status: 'dispatched' };
      }
      if (!this.moveFlushEnqueued) {
        this.moveFlushEnqueued = true;
        this.chainDepth += 1;
        let flushOutcome: DomElementInputOutcome = { status: 'dispatched' };
        const flush = this.chain.then(async () => {
          this.moveFlushEnqueued = false;
          try {
            await this.flushMove();
          } catch {
            flushOutcome = { status: 'dropped', reason: 'cdp_error' };
          } finally {
            this.chainDepth = Math.max(0, this.chainDepth - 1);
          }
        });
        this.chain = flush;
        await flush;
        return flushOutcome;
      }
      return { status: 'dispatched' };
    }

    let outcome: DomElementInputOutcome = { status: 'dispatched' };
    this.chainDepth += 1;
    const run = async () => {
      try {
        outcome = await this.dispatchNow(event);
      } catch {
        outcome = { status: 'dropped', reason: 'cdp_error' };
      } finally {
        this.chainDepth = Math.max(0, this.chainDepth - 1);
      }
    };

    this.chain = this.chain.then(run, run);
    await this.chain;
    return outcome;
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

    const currentGen = this.projection?.getGeneration?.() ?? 0;
    if (
      event.generation != null
      && event.generation > 0
      && currentGen > 0
      && event.generation !== currentGen
    ) {
      return { status: 'dropped', reason: 'generation_stale' };
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
      const reason = await this.dispatchMouse('mousePressed', payload);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'mouseup' || type === 'pointerup') {
      const reason = await this.dispatchMouse('mouseReleased', payload);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'wheel') {
      await this.dispatchWheel(payload);
      return { status: 'dispatched' };
    }
    if (type === 'keydown' || type === 'keyup') {
      const reason = await this.dispatchKey(type, event.anchor, payload, event.targetId);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'input') {
      const reason = await this.dispatchInput(event.anchor, payload, event.targetId);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'setfiles') {
      const reason = await this.dispatchSetFiles(event.anchor, payload, event.targetId);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'scrollviewport') {
      await this.dispatchScrollViewport(payload);
      return { status: 'dispatched' };
    }
    if (type === 'scrollelement') {
      const reason = await this.dispatchScrollElement(event.anchor, payload, event.targetId);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'focus') {
      const reason = await this.focusAnchor(event.anchor, event.targetId);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'blur') {
      const reason = await this.blurAnchor(event.anchor, event.targetId);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    return { status: 'dropped', reason: 'unknown_type' };
  }

  /** Queue latest move coords. Returns false when payload coords are invalid. */
  private acceptMove(payload: IntentPayload): boolean {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.pendingMove = { x, y };
    this.pendingMoveAtMs = Date.now();
    return true;
  }

  private async flushMove(): Promise<void> {
    const next = this.pendingMove;
    this.pendingMove = null;
    this.pendingMoveAtMs = 0;
    if (!next) return;
    if (this.lastMove && this.lastMove.x === next.x && this.lastMove.y === next.y) return;
    this.lastMove = next;
    await this.page.mouse.move(next.x, next.y);
  }

  /** @returns drop reason or null when CDP work ran. */
  private async dispatchMouse(
    type: 'mousePressed' | 'mouseReleased',
    payload: IntentPayload,
  ): Promise<string | null> {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'invalid_coords';
    const button = mouseButtonName(payload.button);
    if (type === 'mousePressed') {
      await this.page.mouse.move(x, y);
      this.lastMove = { x, y };
      await this.page.mouse.down({ button });
    } else {
      await this.page.mouse.move(x, y);
      this.lastMove = { x, y };
      await this.page.mouse.up({ button });
    }
    return null;
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

  /** @returns drop reason or null when CDP work ran / intentional keyup skip after insertText. */
  private async dispatchKey(
    type: 'keydown' | 'keyup',
    anchor: string | null | undefined,
    payload: IntentPayload,
    targetId?: number | null,
  ): Promise<string | null> {
    if (anchor || (targetId && targetId > 0)) {
      const focusReason = await this.focusAnchor(anchor, targetId);
      if (focusReason) return focusReason;
    }
    const key = typeof payload.key === 'string' ? payload.key : '';
    if (!key) return 'empty_key';
    if (type === 'keydown') {
      const mods = payload.modifiers;
      const hasMod = !!(mods?.alt || mods?.ctrl || mods?.meta);
      if (!hasMod && key.length === 1 && !payload.repeat) {
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

  private async dispatchInput(
    anchor: string | null | undefined,
    payload: IntentPayload,
    targetId?: number | null,
  ): Promise<string | null> {
    const el = await this.resolveElement(anchor, targetId);
    if (!el) return 'anchor_missing';
    try {
      await el.focus();
      if (typeof payload.checked === 'boolean') {
        await el.evaluate((node, checked) => {
          const input = node as {
            type?: string;
            checked?: boolean;
            dispatchEvent: (e: unknown) => boolean;
          };
          const Ev = (globalThis as { Event: new (t: string, i?: object) => unknown }).Event;
          if (input.type === 'checkbox' || input.type === 'radio') {
            input.checked = checked;
            input.dispatchEvent(new Ev('input', { bubbles: true }));
            input.dispatchEvent(new Ev('change', { bubbles: true }));
          }
        }, payload.checked);
        return null;
      }
      const value = typeof payload.value === 'string' ? payload.value : '';
      await el.fill(value, { force: true, timeout: 2_000 }).catch(async () => {
        await el.evaluate((node, v) => {
          const input = node as {
            value?: string;
            dispatchEvent: (e: unknown) => boolean;
          };
          const Ev = (globalThis as { Event: new (t: string, i?: object) => unknown }).Event;
          if ('value' in input) input.value = v;
          input.dispatchEvent(new Ev('input', { bubbles: true }));
          input.dispatchEvent(new Ev('change', { bubbles: true }));
        }, value);
      });
      return null;
    } finally {
      await el.dispose().catch(() => undefined);
    }
  }

  private async dispatchSetFiles(
    anchor: string | null | undefined,
    payload: IntentPayload,
    targetId?: number | null,
  ): Promise<string | null> {
    const el = await this.resolveElement(anchor, targetId);
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

  private async dispatchScrollElement(
    anchor: string | null | undefined,
    payload: IntentPayload,
    targetId?: number | null,
  ): Promise<string | null> {
    const top = Number(payload.scrollTop ?? 0);
    const left = Number(payload.scrollLeft ?? 0);
    const el = await this.resolveElement(anchor, targetId);
    if (!el) return 'anchor_missing';
    try {
      await el.evaluate(
        (node, pos) => {
          const n = node as {
            scrollTop: number;
            scrollLeft: number;
            getAttribute: (k: string) => string | null;
          };
          const a = n.getAttribute('speculum-anchor');
          const g = globalThis as typeof globalThis & {
            __speculumDomNoteScrollEcho?: (n: unknown) => void;
            __speculumDomConsumeScrollEchoIfAt?: (n: unknown) => boolean;
            top?: {
              __speculumDomNoteScrollEcho?: (n: unknown) => void;
              __speculumDomConsumeScrollEchoIfAt?: (n: unknown) => boolean;
            };
          };
          let note = g.__speculumDomNoteScrollEcho;
          let consume = g.__speculumDomConsumeScrollEchoIfAt;
          if (!note || !consume) {
            try {
              note = note ?? g.top?.__speculumDomNoteScrollEcho;
              consume = consume ?? g.top?.__speculumDomConsumeScrollEchoIfAt;
            } catch { /* XO */ }
          }
          if (a) {
            const mark = { element: { anchor: a, top: pos.top, left: pos.left } };
            // Contract: note before mutate so sync scroll sensors see the echo mark.
            note?.(mark);
            const beforeTop = n.scrollTop || 0;
            const beforeLeft = n.scrollLeft || 0;
            n.scrollTop = pos.top;
            n.scrollLeft = pos.left;
            const afterTop = n.scrollTop || 0;
            const afterLeft = n.scrollLeft || 0;
            if (
              beforeTop === afterTop
              && beforeLeft === afterLeft
              && afterTop === pos.top
              && afterLeft === pos.left
            ) {
              consume?.(mark);
            }
          } else {
            n.scrollTop = pos.top;
            n.scrollLeft = pos.left;
          }
        },
        { top, left },
      );
      return null;
    } finally {
      await el.dispose().catch(() => undefined);
    }
  }

  private async focusAnchor(anchor: string | null | undefined, targetId?: number | null): Promise<string | null> {
    const el = await this.resolveElement(anchor, targetId);
    if (!el) return 'anchor_missing';
    try {
      await el.focus();
      return null;
    } finally {
      await el.dispose().catch(() => undefined);
    }
  }

  private async blurAnchor(anchor: string | null | undefined, targetId?: number | null): Promise<string | null> {
    const el = await this.resolveElement(anchor, targetId);
    if (!el) return 'anchor_missing';
    try {
      await el.evaluate((node) => {
        const n = node as { blur?: () => void };
        n.blur?.();
      });
      return null;
    } finally {
      await el.dispose().catch(() => undefined);
    }
  }

  /**
   * Pierce-aware resolve (input §6.7 / redesign §5.11):
   * Prefer uint32 targetId via __speculumPageProjectionV2.reverse map;
   * fall back to deprecated speculum-anchor string for V1 transition.
   */
  private async resolveElement(
    anchor: string | null | undefined,
    targetId?: number | null,
  ): Promise<ElementHandle | null> {
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

function mouseButtonName(button: number | undefined): 'left' | 'middle' | 'right' {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
}
