import { createHash } from 'node:crypto';

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 256;

export type DomAssetEntry = {
  body: Buffer;
  contentType: string;
};

/**
 * Hash → bytes LRU for Dom Projection css/img/font (sidecar-side).
 */
export class DomAssetCache {
  private readonly assets = new Map<string, DomAssetEntry>();
  private order: string[] = [];

  constructor(
    private readonly maxBytes = DEFAULT_MAX_BYTES,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  get(hash: string): DomAssetEntry | undefined {
    return this.assets.get(hash);
  }

  put(body: Buffer, contentType: string): string | null {
    if (body.byteLength === 0 || body.byteLength > this.maxBytes) return null;
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 32);
    if (!this.assets.has(hash)) {
      this.assets.set(hash, { body, contentType });
      this.order.push(hash);
      while (this.order.length > this.maxEntries) {
        const old = this.order.shift();
        if (old) this.assets.delete(old);
      }
    }
    return hash;
  }

  clear(): void {
    this.assets.clear();
    this.order = [];
  }

  get size(): number {
    return this.assets.size;
  }
}
