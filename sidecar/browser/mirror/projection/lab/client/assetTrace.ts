/**
 * Lab asset H5 absolute trace — ring buffer of hop facts (no interpretation).
 * Flushed into sameS / CLI dossier.
 */

export type AssetTraceEvent = Record<string, unknown> & {
  t: number;
  hop: string;
};

const MAX = 20000;
const events: AssetTraceEvent[] = [];

function now(): number {
  return typeof performance !== 'undefined' && performance.now
    ? Math.round(performance.timeOrigin + performance.now())
    : Date.now();
}

function traceAllEnabled(): boolean {
  return !!(globalThis as { __SPECULUM_ASSET_TRACE?: boolean }).__SPECULUM_ASSET_TRACE;
}

/** Liga traço de todos os ativos (lab diag). Sem isto, só logo.svg. */
export function enableAssetTraceAll(): void {
  (globalThis as { __SPECULUM_ASSET_TRACE?: boolean }).__SPECULUM_ASSET_TRACE = true;
}

/** FNV-1a 64-bit → 16 hex — same algorithm as SpeculumAssetRegistry.cpp BodyFnv16. */
export function bodyFnv16(bytes: Uint8Array | ArrayBuffer | null | undefined): string {
  const u8 =
    bytes instanceof Uint8Array
      ? bytes
      : bytes
        ? new Uint8Array(bytes)
        : new Uint8Array(0);
  let h = 14695981039346656037n;
  const prime = 1099511628211n;
  for (let i = 0; i < u8.length; i++) {
    h ^= BigInt(u8[i]!);
    h = BigInt.asUintN(64, h * prime);
  }
  return h.toString(16).padStart(16, '0');
}

export function bodyHeadAscii(bytes: Uint8Array, n = 64): string {
  const m = Math.min(bytes.length, n);
  let s = '';
  for (let i = 0; i < m; i++) {
    const c = bytes[i]!;
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
  }
  return s;
}

export function pushAssetTrace(partial: Omit<AssetTraceEvent, 't'> & { t?: number }): void {
  const ev: AssetTraceEvent = { t: partial.t ?? now(), ...partial };
  events.push(ev);
  if (events.length > MAX) events.splice(0, events.length - MAX);
}

export function drainAssetTrace(): AssetTraceEvent[] {
  return events.slice();
}

export function clearAssetTrace(): void {
  events.length = 0;
}

export function urlWorthTracing(url: string): boolean {
  return /logo\.svg/i.test(url) || traceAllEnabled();
}

/** Capture first load/error on imgs in a Projected document. */
export function installImgTrace(doc: Document): () => void {
  const seen = new WeakSet<Element>();
  const onEvent = (type: 'load' | 'error') => (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLImageElement)) return;
    if (seen.has(t) && type === 'load') return;
    const src = t.currentSrc || t.src || '';
    if (!urlWorthTracing(src) && !(t.complete && t.naturalWidth === 0)) {
      if (!/logo\.svg/i.test(src)) return;
    }
    seen.add(t);
    pushAssetTrace({
      hop: 'img.state',
      url: src.slice(0, 300),
      contextId: 1,
      event: type,
      complete: t.complete,
      naturalWidth: t.naturalWidth,
      naturalHeight: t.naturalHeight,
      currentSrc: (t.currentSrc || '').slice(0, 300),
    });
  };
  const onLoad = onEvent('load');
  const onError = onEvent('error');
  doc.addEventListener('load', onLoad, true);
  doc.addEventListener('error', onError, true);
  return () => {
    doc.removeEventListener('load', onLoad, true);
    doc.removeEventListener('error', onError, true);
  };
}

export function sampleImgStates(doc: Document, event = 'sameS'): void {
  const imgs = [...doc.images];
  const allBroken = traceAllEnabled();
  let broken = 0;
  for (const img of imgs) {
    const src = img.currentSrc || img.src || '';
    const isLogo = /logo\.svg/i.test(src);
    const isBroken = img.complete && img.naturalWidth === 0;
    if (!isLogo && !isBroken) continue;
    if (isBroken && !isLogo && !allBroken) {
      if (broken >= 20) continue;
      broken++;
    }
    pushAssetTrace({
      hop: 'img.state',
      url: src.slice(0, 300),
      contextId: 1,
      event,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      currentSrc: (img.currentSrc || '').slice(0, 300),
    });
  }
}
