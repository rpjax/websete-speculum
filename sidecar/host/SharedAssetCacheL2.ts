/**
 * Host-wide, credential-less shared asset tier (§5.12.2, E7b). Public subresource bytes
 * with no session identity are deduplicated across sessions under the shareability gate.
 */

export type SharedAssetRequestKind = 'subresource' | 'navigation_document' | 'xhr_or_fetch';

export type SharedAssetShareabilityDescriptor = {
  requestHadCookie: boolean;
  requestHadAuthorization: boolean;
  cacheControlDirectives: readonly string[];
  varyValues: readonly string[];
  statusCode: number;
  kind: SharedAssetRequestKind;
};

export type SharedAssetTierConfig = {
  maxBytes: number;
  enabled: boolean;
};

export type SharedAssetCacheL2Handle = {
  body: Buffer;
  contentType: string;
  statusCode: number;
  release: () => void;
};

const DEFAULT_MAX_BYTES = 1 << 30;

type Entry = {
  key: string;
  body: Buffer;
  contentType: string;
  statusCode: number;
  sizeBytes: number;
  refCount: number;
  lruNode: Entry | null;
};

export class SharedAssetCacheL2 {
  private readonly byKey = new Map<string, Entry>();
  private readonly lru: Entry[] = [];
  private currentBytes = 0;
  private config: SharedAssetTierConfig = { maxBytes: DEFAULT_MAX_BYTES, enabled: true };
  private configured = false;

  get enabled(): boolean {
    return this.config.enabled;
  }

  get currentBytesTracked(): number {
    return this.currentBytes;
  }

  get count(): number {
    return this.byKey.size;
  }

  /** Immutable host policy — first Launch snapshot wins (motor-migration M5 / I2 exception). */
  configureOnce(config: Partial<SharedAssetTierConfig>): void {
    if (this.configured) return;
    if (config.maxBytes !== undefined) {
      this.config.maxBytes = Math.max(0, config.maxBytes);
    }
    if (config.enabled !== undefined) {
      this.config.enabled = config.enabled;
    }
    this.configured = true;
  }

  tryAcquire(key: string): SharedAssetCacheL2Handle | null {
    if (!key) return null;
    const entry = this.byKey.get(key);
    if (!entry) return null;
    this.touch(entry);
    return this.acquireNoLock(entry);
  }

  put(key: string, body: Buffer, contentType: string, statusCode = 200): SharedAssetCacheL2Handle {
    if (!key) throw new Error('key is required');
    const existing = this.byKey.get(key);
    if (existing) {
      this.touch(existing);
      return this.acquireNoLock(existing);
    }
    const entry: Entry = {
      key,
      body,
      contentType,
      statusCode,
      sizeBytes: body.byteLength,
      refCount: 0,
      lruNode: null,
    };
    this.byKey.set(key, entry);
    entry.lruNode = entry;
    this.lru.push(entry);
    this.currentBytes += entry.sizeBytes;
    const handle = this.acquireNoLock(entry);
    this.evictOverCapNoLock();
    return handle;
  }

  private acquireNoLock(entry: Entry): SharedAssetCacheL2Handle {
    entry.refCount += 1;
    let released = false;
    return {
      body: entry.body,
      contentType: entry.contentType,
      statusCode: entry.statusCode,
      release: () => {
        if (released) return;
        released = true;
        entry.refCount = Math.max(0, entry.refCount - 1);
      },
    };
  }

  private touch(entry: Entry): void {
    if (!entry.lruNode) return;
    const idx = this.lru.indexOf(entry.lruNode);
    if (idx !== -1) this.lru.splice(idx, 1);
    entry.lruNode = entry;
    this.lru.push(entry);
  }

  private evictOverCapNoLock(): void {
    const cap = this.config.maxBytes;
    this.evictPassNoLock(cap, true);
    this.evictPassNoLock(cap, false);
  }

  private evictPassNoLock(cap: number, onlyUnreferenced: boolean): void {
    for (let i = 0; i < this.lru.length && this.currentBytes > cap; i++) {
      const entry = this.lru[i]!;
      if (onlyUnreferenced && entry.refCount !== 0) continue;
      this.evictEntryNoLock(entry);
      i -= 1;
    }
  }

  private evictEntryNoLock(entry: Entry): void {
    const idx = this.lru.indexOf(entry);
    if (idx !== -1) this.lru.splice(idx, 1);
    entry.lruNode = null;
    this.byKey.delete(entry.key);
    this.currentBytes -= entry.sizeBytes;
  }

  static isShareable(descriptor: SharedAssetShareabilityDescriptor): boolean {
    if (descriptor.requestHadCookie || descriptor.requestHadAuthorization) return false;
    if (descriptor.kind !== 'subresource') return false;
    for (const directive of descriptor.cacheControlDirectives) {
      const normalized = directive.trim().toLowerCase();
      if (normalized === 'private' || normalized === 'no-store' || normalized === 'no-cache') {
        return false;
      }
    }
    for (const vary of descriptor.varyValues) {
      const normalized = vary.trim().toLowerCase();
      if (normalized === 'cookie' || normalized === 'authorization' || normalized === '*') {
        return false;
      }
    }
    return isCacheableStatus(descriptor.statusCode);
  }

  static buildKey(
    scheme: string,
    host: string,
    port: number,
    path: string,
    strippedQuery: string,
    varyValues: readonly string[],
    credentialMode: string,
  ): string {
    const vary =
      varyValues.length === 0
        ? ''
        : [...varyValues]
            .map((v) => v.trim().toLowerCase())
            .sort()
            .join(',');
    return `${scheme}://${host}:${port}${path}${strippedQuery}|vary=${vary}|cred=${credentialMode}`;
  }

  static buildAssetKey(virtualKey: string): string {
    return SharedAssetCacheL2.buildKey('asset', virtualKey, 0, '', '', [], 'none');
  }
}

function isCacheableStatus(statusCode: number): boolean {
  return statusCode === 200
    || statusCode === 203
    || statusCode === 204
    || statusCode === 206
    || statusCode === 300
    || statusCode === 301
    || statusCode === 308;
}
