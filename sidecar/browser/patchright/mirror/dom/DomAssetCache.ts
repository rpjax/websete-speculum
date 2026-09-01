import { createHash } from 'node:crypto';

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 512;

/**
 * §5.12.2.1 shareability signals captured at fetch time — read back by
 * `PatchrightBrowserSession.getDomAsset` and relayed to the API so its
 * `SharedAssetCacheL2` predicate can decide host-wide dedup without ever
 * re-deriving them from a response it never saw.
 */
export type DomAssetShareability = {
  /** The outgoing request would have carried a `Cookie` header for this URL. */
  requestHadCookie: boolean;
  /** The original in-page fetch carried an `Authorization` header (Network). */
  requestHadAuthorization?: boolean;
  /** Raw `Cache-Control` response header value, if present. */
  cacheControl?: string;
  /** Raw `Vary` response header value, if present. */
  vary?: string;
};

export type DomAssetEntry = {
  body: Buffer;
  contentType: string;
  sourceUrl?: string;
  mode: 'cache' | 'pass-through';
  shareability?: DomAssetShareability;
};

/**
 * Session asset store for Dom Projection (path-keyed + optional hash lookup).
 *
 * Evicts on two independent caps, either one triggers eviction (§5.16
 * `assetCacheL1MaxBytes`, PP-ASSET-4): a max entry count and a max total byte
 * budget summed across every stored body. Eviction order is insertion order
 * (FIFO) — a `get()` does not bump recency, matching the entry-count
 * eviction this cache always had.
 */
export class DomAssetCache {
  private readonly byKey = new Map<string, DomAssetEntry>();
  private readonly byHash = new Map<string, DomAssetEntry>();
  private readonly keyToHash = new Map<string, string>();
  private order: string[] = [];
  private totalBytes = 0;

  constructor(
    private readonly maxBytes = DEFAULT_MAX_BYTES,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  get(key: string): DomAssetEntry | undefined {
    return this.byKey.get(key) ?? this.byHash.get(key);
  }

  getByHash(hash: string): DomAssetEntry | undefined {
    return this.byHash.get(hash);
  }

  put(
    key: string,
    body: Buffer,
    contentType: string,
    opts?: {
      sourceUrl?: string;
      mode?: 'cache' | 'pass-through';
      shareability?: DomAssetShareability;
    },
  ): string | null {
    if (body.byteLength === 0 || body.byteLength > this.maxBytes) return null;
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 32);
    const entry: DomAssetEntry = {
      body,
      contentType,
      sourceUrl: opts?.sourceUrl,
      mode: opts?.mode ?? 'cache',
      shareability: opts?.shareability,
    };
    // Re-putting the same key replaces its bytes and refreshes its FIFO slot —
    // drop the stale `order` reference first so eviction never double-counts it.
    if (this.byKey.has(key)) {
      const staleIndex = this.order.indexOf(key);
      if (staleIndex !== -1) this.order.splice(staleIndex, 1);
    }
    this.evictKey(key);
    this.byKey.set(key, entry);
    this.byHash.set(hash, entry);
    this.keyToHash.set(key, hash);
    this.order.push(key);
    this.totalBytes += body.byteLength;
    while (this.order.length > 0 && (this.order.length > this.maxEntries || this.totalBytes > this.maxBytes)) {
      const old = this.order.shift();
      if (old !== undefined) this.evictKey(old);
    }
    return hash;
  }

  putBlob(id: string, body: Buffer, contentType: string): void {
    this.put(`_blob/${id}`, body, contentType, { mode: 'cache' });
  }

  putData(id: string, body: Buffer, contentType: string): void {
    this.put(`_data/${id}`, body, contentType, { mode: 'cache' });
  }

  registerPassThrough(key: string, sourceUrl: string, contentType = 'application/octet-stream'): void {
    const existing = this.byKey.get(key);
    if (existing && existing.body.byteLength > 0) return;
    this.byKey.set(key, {
      body: Buffer.alloc(0),
      contentType,
      sourceUrl,
      mode: 'pass-through',
    });
  }

  clear(): void {
    this.byKey.clear();
    this.byHash.clear();
    this.keyToHash.clear();
    this.order = [];
    this.totalBytes = 0;
  }

  get size(): number {
    return this.byKey.size;
  }

  /** Sum of stored body bytes (PP-ASSET-4) — pass-through entries carry no bytes. */
  get currentBytes(): number {
    return this.totalBytes;
  }

  private evictKey(key: string): void {
    const existing = this.byKey.get(key);
    if (!existing) return;
    this.totalBytes -= existing.body.byteLength;
    this.byKey.delete(key);
    const hash = this.keyToHash.get(key);
    if (hash !== undefined) {
      this.byHash.delete(hash);
      this.keyToHash.delete(key);
    }
  }
}

export function virtualAssetKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

export function isPassThroughUrl(url: string, contentType?: string): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('video/') || ct.startsWith('audio/')) return true;
  const path = url.split('?')[0]!.toLowerCase();
  return /\.(mp4|webm|m4v|mov|mp3|wav|ogg|m3u8|mpd|ts)(\?|$)/i.test(path);
}
