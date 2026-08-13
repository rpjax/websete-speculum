/**
 * Live asset L1 prefetch + pass-through fetch (§5.12).
 */

import type { Page } from 'patchright';
import { DomAssetCache, isPassThroughUrl, type DomAssetShareability } from '../dom/DomAssetCache';
import { VIRTUAL_ASSETS_PREFIX } from './fmap';
import { AssetPriorityQueue } from './assetPriority';
import { NodeMirror } from './node/mirror';

/** First header value, tolerating Playwright's `string | string[]` header shape. */
export function headerValue(
  headers: Record<string, string | string[]>,
  name: string,
): string | undefined {
  const raw = headers[name];
  return typeof raw === 'string' ? raw : (raw as unknown as string[] | undefined)?.[0];
}

/**
 * API / gRPC serve key is `{host}{path}?{query}` — never the `/w7s/virtual-assets/`
 * wire prefix. Prefetch and L1 must use the same key or every Projected fetch misses.
 */
export function toDomAssetServeKey(urlOrKey: string): string {
  const s = urlOrKey.trim();
  if (s.startsWith(VIRTUAL_ASSETS_PREFIX)) return s.slice(VIRTUAL_ASSETS_PREFIX.length);
  const abs = /\/w7s\/virtual-assets\/(.+)$/i.exec(s);
  if (abs?.[1]) return abs[1];
  return s;
}

/**
 * §5.12.2.1 — whether *this* request would have carried a `Cookie` header. Read from
 * the browser context's own cookie jar for `sourceUrl` rather than guessed, so the
 * signal the API's `SharedAssetCacheL2` predicate gates on is never fabricated.
 */
export async function requestHadCookie(page: Page, sourceUrl: string): Promise<boolean> {
  try {
    const cookies = await page.context().cookies([sourceUrl]);
    return cookies.length > 0;
  } catch {
    return false;
  }
}

export type PassThroughFetchResult = {
  body: Buffer;
  contentType: string;
  statusCode: number;
  contentRange?: string;
  shareability: DomAssetShareability;
  /** 'cache' ⇒ safe to buffer-and-replay same-session AND L2-eligible; 'pass-through' ⇒ neither. */
  mode: 'cache' | 'pass-through';
};

/**
 * §5.12.2 — fetch (and optionally L1-buffer) a virtual-asset URL through the page context.
 */
export async function fetchPassThroughAsset(opts: {
  page: Page;
  assets: DomAssetCache;
  authByUrl: Map<string, boolean>;
  key: string;
  rangeHeader?: string;
}): Promise<PassThroughFetchResult | null> {
  const { page, assets, authByUrl, rangeHeader } = opts;
  const key = toDomAssetServeKey(opts.key);
  const cached = assets.get(key);
  const sourceUrl = cached?.sourceUrl ?? (key.includes('://') ? key : `https://${key}`);
  try {
    const headers: Record<string, string> = {};
    if (rangeHeader) headers['Range'] = rangeHeader;
    const hadCookie = await requestHadCookie(page, sourceUrl);
    const requestHadAuthorization = authByUrl.get(sourceUrl) === true;
    const res = await page.context().request.get(sourceUrl, { timeout: 30_000, headers });
    if (!res.ok() && res.status() !== 206) return null;
    const buf = Buffer.from(await res.body());
    const resHeaders = res.headers();
    const contentType =
      headerValue(resHeaders, 'content-type')?.split(';')[0]?.trim()
      || cached?.contentType
      || 'application/octet-stream';
    const contentRange = headerValue(resHeaders, 'content-range');
    const shareability: DomAssetShareability = {
      requestHadCookie: hadCookie,
      requestHadAuthorization,
      cacheControl: headerValue(resHeaders, 'cache-control'),
      vary: headerValue(resHeaders, 'vary'),
    };
    // §5.12.2 — a plain (non-Range) fetch of a non-streaming resource is safe to serve
    // straight from the buffered copy on repeat same-session requests ('cache' mode);
    // Range requests and streaming/media URLs (isPassThroughUrl) always re-verify with
    // the origin ('pass-through') — never buffered-and-replayed for those (PP-ASSET-*).
    const mode = !rangeHeader && !isPassThroughUrl(sourceUrl, contentType) ? 'cache' : 'pass-through';
    if (!rangeHeader && buf.byteLength > 0 && buf.byteLength < 2 * 1024 * 1024) {
      assets.put(key, buf, contentType, { sourceUrl, mode, shareability });
    }
    return { body: buf, contentType, statusCode: res.status(), contentRange, shareability, mode };
  } catch {
    return null;
  }
}

/** §5.12.1 — enqueue L1 fetches by viewport proximity, then drain highest-first. */
export async function scheduleAssetPrefetch(opts: {
  mirror: NodeMirror;
  viewport: { width: number; height: number };
  assetQueue: AssetPriorityQueue;
  assetPriorityViewportPx: number;
  assets: DomAssetCache;
  fetchPassThrough: (key: string) => Promise<PassThroughFetchResult | null>;
  pageEpochId: string;
  tVirtualMs: () => number;
  onParity?: (kind: string, payload: Record<string, unknown>) => void;
}): Promise<void> {
  const {
    mirror,
    assetQueue,
    assets,
    fetchPassThrough,
    pageEpochId,
    tVirtualMs,
    onParity,
  } = opts;
  assetQueue.clear();
  // Mirror element nodes have no layout boxes here — CSS-first then FIFO document
  // order. Do not invent viewport distances; AssetPriorityQueue margin applies only
  // when real geometry is supplied later.
  void opts.viewport;
  void opts.assetPriorityViewportPx;
  const rootId = mirror.root;
  if (rootId == null) return;
  let fifo = 0;
  const walk = (id: number): void => {
    const node = mirror.get(id);
    if (!node || node.kind !== 'element') return;
    const tag = node.tag.toLowerCase();
    const isCss = tag === 'link' && /stylesheet/i.test(node.attrs['rel'] ?? '');
    const candidates: string[] = [];
    for (const attr of ['src', 'href', 'poster', 'data-src', 'srcset', 'imagesrcset']) {
      const v = node.attrs[attr];
      if (!v) continue;
      if (attr === 'srcset' || attr === 'imagesrcset') {
        for (const part of v.split(',')) {
          const url = part.trim().split(/\s+/)[0];
          if (url && url.startsWith(VIRTUAL_ASSETS_PREFIX)) candidates.push(url);
        }
      } else if (v.startsWith(VIRTUAL_ASSETS_PREFIX)) {
        candidates.push(v);
      }
    }
    for (const raw of candidates) {
      const distancePx = isCss ? 0 : ++fifo;
      const key = toDomAssetServeKey(raw);
      const sourceUrl = key.includes('://') ? key : `https://${key}`;
      assetQueue.enqueue({
        key,
        sourceUrl,
        distancePx,
        isCss,
      });
    }
    for (const childId of node.childIds) walk(childId);
  };
  walk(rootId);
  // CSS-first FIFO; low concurrency so Virtual CDP is not starved.
  const MAX_DRAIN = 256;
  const CONCURRENCY = 2;
  let drained = 0;
  const workers: Promise<void>[] = [];
  const runJob = async (): Promise<void> => {
    while (drained < MAX_DRAIN) {
      const job = assetQueue.takeNext();
      if (!job) return;
      drained += 1;
      const started = Date.now();
      if (assets.get(job.key)) continue;
      const fetched = await fetchPassThrough(job.key);
      const durationMs = Date.now() - started;
      if (!fetched) {
        onParity?.('parity_asset_fetch_finished', {
          pageEpochId,
          urlKey: job.key,
          durationMs,
          bytes: 0,
          mode: 'miss',
          ok: false,
          tVirtualMs: tVirtualMs(),
        });
      } else {
        onParity?.('parity_asset_fetch_finished', {
          pageEpochId,
          urlKey: job.key,
          durationMs,
          bytes: fetched.body.byteLength,
          mode: fetched.mode,
          ok: true,
          tVirtualMs: tVirtualMs(),
        });
      }
    }
  };
  for (let i = 0; i < CONCURRENCY; i += 1) workers.push(runJob());
  await Promise.all(workers);
}

/** E7 — mirror byte budget; trim leaves with telemetry (never silent). */
export function enforceMirrorMaxBytes(opts: {
  mirror: NodeMirror;
  mirrorMaxBytes: number;
  pageEpochId: string;
  generation: number;
  onParity?: (kind: string, payload: Record<string, unknown>) => void;
}): void {
  const { mirror, mirrorMaxBytes, pageEpochId, generation, onParity } = opts;
  const before = mirror.estimateBytes();
  if (before <= mirrorMaxBytes) return;
  const removed = mirror.trimToBudget(mirrorMaxBytes);
  onParity?.('parity_mirror_trim', {
    pageEpochId,
    beforeBytes: before,
    afterBytes: mirror.estimateBytes(),
    removedNodes: removed,
    mirrorMaxBytes,
    generation,
  });
}
