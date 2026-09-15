/**
 * Encoder do Input neste fio (ABI doc 18). Sem JSON. Sem MessagePack.
 * O lab Chromium continua no caminho JSON dele; este módulo é o fio Gecko.
 */

import type { UnifiedIntent } from './unifiedIntentTypes';

export const GECKO_OP_INPUT = 0x0108;
export const GECKO_OP_HISTORY_GO = 0x0106;
export const GECKO_OP_VIEWPORT_SET = 0x0107;

export const GECKO_INPUT_DOWN = 1;
export const GECKO_INPUT_UP = 2;
export const GECKO_INPUT_KEY_DOWN = 3;
export const GECKO_INPUT_KEY_UP = 4;
export const GECKO_INPUT_SCROLL_SET = 5;

const HEADER = 6;

function writeU8(buf: Uint8Array, off: number, v: number): number {
  buf[off] = v & 0xff;
  return off + 1;
}

function writeU16(buf: Uint8Array, off: number, v: number): number {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  return off + 2;
}

function writeU32(buf: Uint8Array, off: number, v: number): number {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
  return off + 4;
}

function writeI32(buf: Uint8Array, off: number, v: number): number {
  return writeU32(buf, off, v | 0);
}

function writeStr(buf: Uint8Array, off: number, value: string): number {
  const bytes = new TextEncoder().encode(value);
  off = writeU32(buf, off, bytes.length);
  buf.set(bytes, off);
  return off + bytes.length;
}

function strSize(value: string): number {
  return 4 + new TextEncoder().encode(value).length;
}

function header(buf: Uint8Array, op: number, corr: number): number {
  let off = 0;
  off = writeU16(buf, off, op);
  return writeU32(buf, off, corr);
}

export function fracToU16(f: number | undefined | null): number {
  if (f == null || Number.isNaN(f)) {
    return 32768;
  }
  if (f <= 0) {
    return 0;
  }
  if (f >= 1) {
    return 65535;
  }
  return Math.round(f * 65535);
}

export function buttonToU8(button?: string): number {
  if (button === 'middle') {
    return 1;
  }
  if (button === 'right') {
    return 2;
  }
  return 0;
}

export function modsToU8(mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }): number {
  let v = 0;
  if (mods?.ctrl) v |= 1;
  if (mods?.shift) v |= 2;
  if (mods?.alt) v |= 4;
  if (mods?.meta) v |= 8;
  return v;
}

export function encodeInputPointer(
  corr: number,
  ctx: number,
  type: typeof GECKO_INPUT_DOWN | typeof GECKO_INPUT_UP,
  nodeId: number,
  localX: number,
  localY: number,
  button: number,
): Uint8Array {
  const buf = new Uint8Array(HEADER + 4 + 1 + 4 + 2 + 2 + 1);
  let off = header(buf, GECKO_OP_INPUT, corr);
  off = writeU32(buf, off, ctx);
  off = writeU8(buf, off, type);
  off = writeU32(buf, off, nodeId);
  off = writeU16(buf, off, localX);
  off = writeU16(buf, off, localY);
  writeU8(buf, off, button);
  return buf;
}

export function encodeInputKey(
  corr: number,
  ctx: number,
  type: typeof GECKO_INPUT_KEY_DOWN | typeof GECKO_INPUT_KEY_UP,
  key: string,
  code: string,
  mods: number,
): Uint8Array {
  const buf = new Uint8Array(HEADER + 4 + 1 + strSize(key) + strSize(code) + 1);
  let off = header(buf, GECKO_OP_INPUT, corr);
  off = writeU32(buf, off, ctx);
  off = writeU8(buf, off, type);
  off = writeStr(buf, off, key);
  off = writeStr(buf, off, code);
  writeU8(buf, off, mods);
  return buf;
}

export function encodeInputScroll(
  corr: number,
  ctx: number,
  nodeId: number,
  fracX: number,
  fracY: number,
): Uint8Array {
  const buf = new Uint8Array(HEADER + 4 + 1 + 4 + 2 + 2);
  let off = header(buf, GECKO_OP_INPUT, corr);
  off = writeU32(buf, off, ctx);
  off = writeU8(buf, off, GECKO_INPUT_SCROLL_SET);
  off = writeU32(buf, off, nodeId);
  off = writeU16(buf, off, fracX);
  writeU16(buf, off, fracY);
  return buf;
}

export function encodeHistoryGo(corr: number, ctx: number, delta: number): Uint8Array {
  const buf = new Uint8Array(HEADER + 4 + 4);
  let off = header(buf, GECKO_OP_HISTORY_GO, corr);
  off = writeU32(buf, off, ctx);
  writeI32(buf, off, delta);
  return buf;
}

export function encodeViewportSet(corr: number, ctx: number, width: number, height: number): Uint8Array {
  const buf = new Uint8Array(HEADER + 4 + 4 + 4);
  let off = header(buf, GECKO_OP_VIEWPORT_SET, corr);
  off = writeU32(buf, off, ctx);
  off = writeI32(buf, off, width);
  writeI32(buf, off, height);
  return buf;
}

/** `move` e `setFiles` não entram neste fio. `historyNav` vira HistoryGo. */
export function encodeControlFromIntent(
  corr: number,
  ctx: number,
  intent: UnifiedIntent,
): Uint8Array | null {
  if (intent.type === 'down' || intent.type === 'up') {
    const nodeId = intent.nodeId ?? 0;
    return encodeInputPointer(
      corr,
      intent.contextId ?? ctx,
      intent.type === 'down' ? GECKO_INPUT_DOWN : GECKO_INPUT_UP,
      nodeId,
      fracToU16(intent.localX),
      fracToU16(intent.localY),
      buttonToU8(intent.button),
    );
  }
  if (intent.type === 'keyDown' || intent.type === 'keyUp') {
    return encodeInputKey(
      corr,
      ctx,
      intent.type === 'keyDown' ? GECKO_INPUT_KEY_DOWN : GECKO_INPUT_KEY_UP,
      intent.key,
      intent.code,
      modsToU8(intent.modifiers),
    );
  }
  if (intent.type === 'scrollSet') {
    return encodeInputScroll(
      corr,
      intent.contextId ?? ctx,
      intent.nodeId ?? 0,
      fracToU16(intent.scrollFracX),
      fracToU16(intent.scrollFracY),
    );
  }
  if (intent.type === 'historyNav') {
    return encodeHistoryGo(corr, ctx, intent.direction === 'back' ? -1 : 1);
  }
  return null;
}
