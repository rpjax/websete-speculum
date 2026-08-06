import { createHash } from 'node:crypto';

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 512;

export type DomAssetEntry = {
  body: Buffer;
  contentType: string;
  sourceUrl?: string;
  mode: 'cache' | 'pass-through';
};

/**
 * Session asset store for Dom Projection (path-keyed + optional hash lookup).
 */
export class DomAssetCache {
  private readonly byKey = new Map<string, DomAssetEntry>();
  private readonly byHash = new Map<string, DomAssetEntry>();
  private order: string[] = [];

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
    opts?: { sourceUrl?: string; mode?: 'cache' | 'pass-through' },
  ): string | null {
    if (body.byteLength === 0 || body.byteLength > this.maxBytes) return null;
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 32);
    const entry: DomAssetEntry = {
      body,
      contentType,
      sourceUrl: opts?.sourceUrl,
      mode: opts?.mode ?? 'cache',
    };
    this.byKey.set(key, entry);
    this.byHash.set(hash, entry);
    this.order.push(key);
    while (this.order.length > this.maxEntries) {
      const old = this.order.shift();
      if (old) this.byKey.delete(old);
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
    this.order = [];
  }

  get size(): number {
    return this.byKey.size;
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
