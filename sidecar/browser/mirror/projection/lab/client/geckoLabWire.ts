/**
 * Fio Gecko do lab: encoder vivo, pedido do browser, SW de ativo.
 * Chromium não importa isto no caminho JSON.
 */

import {
  bytesToBase64,
  encodeAssetRequest,
  encodeControlFromIntent,
  encodeDialogRespond,
  encodeDownloadRespond,
  encodePermissionRespond,
  encodeViewportSet,
} from '@speculum/page-projection/core';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';
import {
  bodyFnv16,
  bodyHeadAscii,
  enableAssetTraceAll,
  pushAssetTrace,
  urlWorthTracing,
} from './assetTrace';

/** ISO BMFF ftyp major/compatible brand → AVIF/HEIF family. */
function isobmffImageBrand(body: Uint8Array): string | null {
  if (body.length < 12) return null;
  const brands = new Set(['avif', 'avis', 'mif1', 'msf1', 'heic', 'heif', 'heim', 'heis']);
  const ascii = (o: number) =>
    String.fromCharCode(body[o]!, body[o + 1]!, body[o + 2]!, body[o + 3]!);
  if (ascii(4) !== 'ftyp') return null;
  const major = ascii(8);
  if (brands.has(major)) return major;
  for (let o = 16; o + 4 <= Math.min(body.length, 64); o += 4) {
    const b = ascii(o);
    if (brands.has(b)) return b;
  }
  return null;
}

function classifyFetchDestination(destination: string): number {
  switch (destination) {
    case 'image':
      return 1;
    case 'font':
      return 2;
    case 'audio':
      return 3;
    case 'video':
      return 4;
    case 'document':
    case 'frame':
    case 'iframe':
    case 'embed':
    case 'object':
      return 10;
    case 'script':
      return 11;
    case 'style':
      return 12;
    case 'websocket':
      return 15;
    case '':
      return 5;
    default:
      return 0;
  }
}

export type GeckoRequestedKind = 'dialog' | 'permission' | 'download';

let gecko = false;
let corr = 1;
const pendingAssets = new Map<
  number,
  {
    chunks: Uint8Array[];
    resolve: (r: Response) => void;
    reject: (e: Error) => void;
    url: string;
    contextId: number;
    range: string;
    dest: string;
    fetchId?: number;
  }
>();
let nextStream = 1;
let swReg: ServiceWorkerRegistration | null = null;

export function setGeckoLab(on: boolean): void {
  gecko = on;
}

export function isGeckoLab(): boolean {
  return gecko;
}

export function nextGeckoCorr(): number {
  corr += 1;
  return corr;
}

export function sendGeckoControl(ws: WebSocket, bytes: Uint8Array): void {
  ws.send(JSON.stringify({ type: 'client.control', bytes: bytesToBase64(bytes) }));
}

export function sendGeckoIntent(ws: WebSocket, intent: UnifiedIntent, ctx: number): boolean {
  const bytes = encodeControlFromIntent(nextGeckoCorr(), intent.contextId ?? ctx, intent);
  if (!bytes) {
    return false;
  }
  sendGeckoControl(ws, bytes);
  return true;
}

export function sendGeckoViewport(ws: WebSocket, width: number, height: number): void {
  sendGeckoControl(ws, encodeViewportSet(nextGeckoCorr(), 0, width, height));
}

export function answerGeckoRequest(
  ws: WebSocket,
  kind: GeckoRequestedKind,
  contextId: number,
  requestId: number,
  yes: boolean,
  text: string,
): void {
  const c = nextGeckoCorr();
  if (kind === 'dialog') {
    sendGeckoControl(ws, encodeDialogRespond(c, contextId, requestId, yes ? text || 'ok' : ''));
    return;
  }
  if (kind === 'permission') {
    sendGeckoControl(ws, encodePermissionRespond(c, contextId, requestId, yes));
    return;
  }
  sendGeckoControl(ws, encodeDownloadRespond(c, contextId, requestId, yes));
}

export function showGeckoPrompt(_kind: GeckoRequestedKind, description: string): { yes: boolean; text: string } {
  const yes = window.confirm(description);
  return { yes, text: yes ? 'ok' : '' };
}

export async function ensureGeckoAssetSw(token: string): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('service worker indisponível');
  }
  swReg = await navigator.serviceWorker.register('/lab/asset-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.removeEventListener('controllerchange', done);
        resolve();
      }
    });
  }
  const sw = navigator.serviceWorker.controller ?? swReg.active;
  sw?.postMessage({ type: 'token', token });
  sw?.postMessage({ type: 'ctx', contextId: CONTEXT_ID_ROOT });
  if ((globalThis as { __SPECULUM_ASSET_TRACE?: boolean }).__SPECULUM_ASSET_TRACE) {
    sw?.postMessage({ type: 'asset-trace-enable', enable: true });
  }
}

export function enableGeckoAssetTraceAll(): void {
  enableAssetTraceAll();
  const sw = navigator.serviceWorker.controller ?? swReg?.active;
  sw?.postMessage({ type: 'asset-trace-enable', enable: true });
}

/** Carimba C no cliente que pede o ativo. Sem isto o join no pai erra no iframe. */
export function registerGeckoAssetContext(contextId: number, win: Window = window): void {
  if (!('serviceWorker' in win.navigator)) {
    return;
  }
  void win.navigator.serviceWorker.ready.then((reg) => {
    (reg.active ?? win.navigator.serviceWorker.controller)?.postMessage({ type: 'ctx', contextId });
  });
}

export function sendGeckoAssetFetch(
  ws: WebSocket,
  ctx: number,
  url: string,
  dest: string,
  range: string,
  fetchId?: number,
): Promise<Response> {
  const streamId = nextStream++;
  const destCode = classifyFetchDestination(dest);
  const payload = encodeAssetRequest(streamId, destCode, url, range, 0);
  if (urlWorthTracing(url)) {
    pushAssetTrace({
      hop: 'lab.request',
      streamId,
      fetchId,
      contextId: ctx,
      url: url.slice(0, 300),
      range,
      dest,
      destCode,
      payloadLen: payload.byteLength,
    });
  }
  return new Promise((resolve, reject) => {
    pendingAssets.set(streamId, {
      chunks: [],
      resolve,
      reject,
      url,
      contextId: ctx,
      range,
      dest,
      fetchId,
    });
    ws.send(JSON.stringify({ type: 'client.asset', contextId: ctx, bytes: bytesToBase64(payload) }));
  });
}

export function onGeckoAssetMessage(streamId: number, phase: number, data: Uint8Array, why: string): void {
  const pending = pendingAssets.get(streamId);
  if (!pending) {
    return;
  }
  if (phase === 2) {
    pendingAssets.delete(streamId);
    if (urlWorthTracing(pending.url)) {
      pushAssetTrace({
        hop: 'lab.response',
        streamId,
        fetchId: pending.fetchId,
        contextId: pending.contextId,
        url: pending.url.slice(0, 300),
        range: pending.range,
        dest: pending.dest,
        phase: 'denied',
        why: why || 'denied',
        chunkTotal: 0,
        bodySha16: bodyFnv16(null),
      });
    }
    console.warn('[gecko-asset] denied', streamId, why || 'denied');
    pending.reject(new Error(why || 'denied'));
    return;
  }
  if (phase === 1 && data.length) {
    pending.chunks.push(data);
  }
  if (phase === 3) {
    pendingAssets.delete(streamId);
    const total = pending.chunks.reduce((n, c) => n + c.length, 0);
    const body = new Uint8Array(total);
    let o = 0;
    for (const c of pending.chunks) {
      body.set(c, o);
      o += c.length;
    }
    const mimeIn = data.length ? new TextDecoder().decode(data) : '';
    let mime = mimeIn;
    const genericMime =
      !mime ||
      mime === 'application/octet-stream' ||
      mime === 'binary/octet-stream' ||
      mime === 'text/plain' ||
      mime === 'application/force-download' ||
      mime === 'text/html' ||
      !mime.toLowerCase().split(';')[0]!.trim().startsWith('image/');
    if (genericMime && body.length) {
      const head = new TextDecoder().decode(body.slice(0, Math.min(256, body.length))).toLowerCase();
      if (head.includes('<svg') || head.includes('<!doctype svg')) {
        mime = 'image/svg+xml';
      } else if (body[0] === 0xff && body[1] === 0xd8) {
        mime = 'image/jpeg';
      } else if (body[0] === 0x89 && body[1] === 0x50) {
        mime = 'image/png';
      } else if (body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46) {
        mime = 'image/gif';
      } else if (
        body.length >= 12 &&
        body[0] === 0x52 &&
        body[8] === 0x57 &&
        body[9] === 0x45 &&
        body[10] === 0x42 &&
        body[11] === 0x50
      ) {
        mime = 'image/webp';
      } else {
        const brand = isobmffImageBrand(body);
        if (brand === 'avif' || brand === 'avis' || brand === 'mif1' || brand === 'msf1') {
          mime = 'image/avif';
        } else if (brand === 'heic' || brand === 'heif' || brand === 'heim' || brand === 'heis') {
          mime = 'image/heic';
        }
      }
    }
    if (urlWorthTracing(pending.url)) {
      pushAssetTrace({
        hop: 'lab.response',
        streamId,
        fetchId: pending.fetchId,
        contextId: pending.contextId,
        url: pending.url.slice(0, 300),
        range: pending.range,
        dest: pending.dest,
        phase: 'complete',
        chunkTotal: total,
        mimeIn,
        mimeOut: mime,
        genericMime,
        bodySha16: bodyFnv16(body),
        bodyHead: bodyHeadAscii(body),
      });
    }
    const headers = new Headers();
    if (mime) {
      headers.set('Content-Type', mime);
    }
    pending.resolve(new Response(body, { headers }));
  }
}

export function wireGeckoSwFetch(ws: WebSocket, ctx: number): void {
  navigator.serviceWorker.addEventListener('message', (ev) => {
    const msg = ev.data as {
      type?: string;
      url?: string;
      dest?: string;
      range?: string;
      id?: number;
      contextId?: number;
      hop?: string;
      event?: Record<string, unknown>;
    };
    if (msg?.type === 'asset-trace' && msg.event && typeof msg.event === 'object') {
      pushAssetTrace(msg.event as Parameters<typeof pushAssetTrace>[0]);
      return;
    }
    if (msg?.type !== 'asset-fetch' || typeof msg.url !== 'string' || typeof msg.id !== 'number') {
      return;
    }
    const fetchCtx =
      typeof msg.contextId === 'number' && Number.isInteger(msg.contextId) && msg.contextId >= 1
        ? msg.contextId
        : ctx;
    void sendGeckoAssetFetch(ws, fetchCtx, msg.url, msg.dest ?? '', msg.range ?? '', msg.id).then(
      async (res) => {
        const buf = new Uint8Array(await res.arrayBuffer());
        const contentType = res.headers.get('Content-Type') || '';
        ev.source?.postMessage(
          { type: 'asset', id: msg.id, ok: true, bytes: buf.buffer, contentType },
          { transfer: [buf.buffer] },
        );
      },
      (err: Error) => {
        ev.source?.postMessage({ type: 'asset', id: msg.id, ok: false, error: err.message });
      },
    );
  });
}
