import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElementHandle, Page } from 'patchright';
import type { DomProjection } from './DomProjection';

export type DomElementInputEvent = {
  type: string;
  anchor?: string | null;
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
  private chain: Promise<void> = Promise.resolve();
  private lastMove: { x: number; y: number } | null = null;
  private pendingMove: { x: number; y: number } | null = null;

  /** Keys that used insertText on keydown — skip matching keyup. */
  private insertTextKeys = new Set<string>();

  constructor(
    private readonly page: Page,
    private readonly projection?: DomProjection,
  ) {}

  async dispatch(event: DomElementInputEvent): Promise<DomElementInputOutcome> {
    let outcome: DomElementInputOutcome = { status: 'dispatched' };
    const run = async () => {
      try {
        outcome = await this.dispatchNow(event);
      } catch {
        outcome = { status: 'dropped', reason: 'cdp_error' };
      }
    };

    this.chain = this.chain.then(run, run);
    await this.chain;
    return outcome;
  }

  private async dispatchNow(event: DomElementInputEvent): Promise<DomElementInputOutcome> {
    const type = event.type.trim().toLowerCase();
    if (type === 'resync') {
      await this.projection?.requestResync();
      return { status: 'dispatched' };
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
      const reason = await this.dispatchKey(type, event.anchor, payload);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'input') {
      const reason = await this.dispatchInput(event.anchor, payload);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'setfiles') {
      const reason = await this.dispatchSetFiles(event.anchor, payload);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'scroll') {
      const reason = await this.dispatchScroll(event.anchor, payload);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'focus') {
      const reason = await this.focusAnchor(event.anchor);
      return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
    }
    if (type === 'blur') {
      const reason = await this.blurAnchor(event.anchor);
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
    return true;
  }

  private async flushMove(): Promise<void> {
    const next = this.pendingMove;
    this.pendingMove = null;
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
  ): Promise<string | null> {
    if (anchor) {
      const focusReason = await this.focusAnchor(anchor);
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
  ): Promise<string | null> {
    const el = await this.resolveElement(anchor);
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
  ): Promise<string | null> {
    const el = await this.resolveElement(anchor);
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

  private async dispatchScroll(
    anchor: string | null | undefined,
    payload: IntentPayload,
  ): Promise<string | null> {
    const top = Number(payload.scrollTop ?? 0);
    const left = Number(payload.scrollLeft ?? 0);
    if (!anchor) {
      await this.page.evaluate(
        ({ top: t, left: l }) => {
          (globalThis as typeof globalThis & { scrollTo: (x: number, y: number) => void }).scrollTo(l, t);
        },
        { top, left },
      );
      return null;
    }
    const el = await this.resolveElement(anchor);
    if (!el) return 'anchor_missing';
    try {
      await el.evaluate(
        (node, pos) => {
          const n = node as { scrollTop: number; scrollLeft: number };
          n.scrollTop = pos.top;
          n.scrollLeft = pos.left;
        },
        { top, left },
      );
      return null;
    } finally {
      await el.dispose().catch(() => undefined);
    }
  }

  private async focusAnchor(anchor: string | null | undefined): Promise<string | null> {
    const el = await this.resolveElement(anchor);
    if (!el) return 'anchor_missing';
    try {
      await el.focus();
      return null;
    } finally {
      await el.dispose().catch(() => undefined);
    }
  }

  private async blurAnchor(anchor: string | null | undefined): Promise<string | null> {
    const el = await this.resolveElement(anchor);
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

  private async resolveElement(
    anchor: string | null | undefined,
  ): Promise<ElementHandle | null> {
    if (!anchor) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const handle = await this.page.evaluateHandle((a) => {
        const w = globalThis as typeof globalThis & {
          __speculumDomResolve?: (anchor: string) => unknown;
        };
        return w.__speculumDomResolve?.(a) ?? null;
      }, anchor);
      const element = handle.asElement() as ElementHandle | null;
      if (element) return element;
      await handle.dispose().catch(() => undefined);
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
