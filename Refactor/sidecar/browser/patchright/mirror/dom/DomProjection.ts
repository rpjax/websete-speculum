import { createHash } from 'node:crypto';
import type { Page, CDPSession } from 'patchright';
import {
  DomAssetCache,
  isPassThroughUrl,
  virtualAssetKeyFromUrl,
} from './DomAssetCache';
import {
  DOM_PROJECTION_PAGE_SCRIPT,
  encodeDomBody,
  type DomDiffBody,
  type DomDiffEmit,
  type DomNodeJson,
} from './DomTreeSerializer';

export type DomProjectionEvents = {
  onDomDiff(diff: DomDiffEmit): void;
  onGenerationBumped?(event: {
    fromGeneration: number;
    toGeneration: number;
    reason: 'main_frame_navigated' | 'page_emit_sync';
    url?: string;
    diffKind?: string;
  }): void;
};

const MAX_ASSET_FETCHES_PER_DIFF = 64;
const VIRTUAL_ASSETS_PREFIX = '/w7s/virtual-assets/';
const VIRTUAL_BLOB_PREFIX = '/w7s/virtual-blob/';
const VIRTUAL_DATA_PREFIX = '/w7s/virtual-data/';

/**
 * Dom Projection F producer: observe → anchor → coalesce → map → rewrite → emit.
 */
export class DomProjection {
  private sequence = 0;
  private generation = 1;
  private stopped = false;
  private readonly assets = new DomAssetCache();
  private materializeChain: Promise<void> = Promise.resolve();
  private readonly uploads = new Map<string, { body: Buffer; contentType: string; name: string }>();

  private constructor(
    private readonly page: Page,
    private readonly events: DomProjectionEvents,
  ) {}

  static async start(page: Page, events: DomProjectionEvents): Promise<DomProjection> {
    const proj = new DomProjection(page, events);
    await page.exposeBinding('__speculumDomEmit', (_source: unknown, payload: unknown) => {
      if (proj.stopped) return;
      proj.emitFromPage(payload);
    });
    await page.addInitScript({ content: DOM_PROJECTION_PAGE_SCRIPT });
    await page.evaluate(DOM_PROJECTION_PAGE_SCRIPT);
    proj.enqueueDocumentDiff();
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame() || proj.stopped) return;
      void proj.onMainFrameNavigated();
    });
    return proj;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.assets.clear();
    this.uploads.clear();
  }

  /** Path-keyed or hash lookup for virtual-asset serve. */
  getAsset(key: string): { body: Buffer; contentType: string; sourceUrl?: string; mode: string } | undefined {
    const e = this.assets.get(key);
    if (!e) return undefined;
    return {
      body: e.body,
      contentType: e.contentType,
      sourceUrl: e.sourceUrl,
      mode: e.mode,
    };
  }

  async fetchPassThrough(
    key: string,
    rangeHeader?: string,
  ): Promise<{
    body: Buffer;
    contentType: string;
    statusCode: number;
    contentRange?: string;
  } | null> {
    const e = this.assets.get(key);
    const sourceUrl = e?.sourceUrl ?? (key.includes('://') ? key : `https://${key}`);
    try {
      const headers: Record<string, string> = {};
      if (rangeHeader) headers.Range = rangeHeader;
      const res = await this.page.context().request.get(sourceUrl, {
        timeout: 30_000,
        headers,
      });
      if (!res.ok() && res.status() !== 206) return null;
      const buf = Buffer.from(await res.body());
      const headerCt = res.headers()['content-type'];
      const ct =
        (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim()
        || e?.contentType
        || 'application/octet-stream';
      const cr = res.headers()['content-range'];
      const contentRange = typeof cr === 'string' ? cr : cr?.[0];
      // Cache small non-range responses for warm re-serve.
      if (!rangeHeader && buf.byteLength > 0 && buf.byteLength < 2 * 1024 * 1024) {
        this.assets.put(key, buf, ct, { sourceUrl, mode: 'pass-through' });
      }
      return {
        body: buf,
        contentType: ct,
        statusCode: res.status(),
        contentRange,
      };
    } catch {
      return null;
    }
  }

  putUpload(id: string, body: Buffer, contentType: string, name: string): void {
    this.uploads.set(id, { body, contentType, name });
  }

  takeUpload(id: string): { body: Buffer; contentType: string; name: string } | undefined {
    const u = this.uploads.get(id);
    if (u) this.uploads.delete(id);
    return u;
  }

  async requestResync(): Promise<void> {
    if (this.stopped) return;
    this.enqueueDocumentDiff();
  }

  getGeneration(): number {
    return this.generation;
  }

  private async onMainFrameNavigated(): Promise<void> {
    try {
      const fromGeneration = this.generation;
      await this.page.evaluate(DOM_PROJECTION_PAGE_SCRIPT);
      const gen = await this.page.evaluate('window.__speculumDomBumpGeneration()');
      if (typeof gen === 'number') this.generation = gen;
      else this.generation += 1;
      this.events.onGenerationBumped?.({
        fromGeneration,
        toGeneration: this.generation,
        reason: 'main_frame_navigated',
        url: this.page.url(),
      });
      this.enqueueDocumentDiff();
    } catch {
      /* mid-navigation */
    }
  }

  /** Map current document and enqueue on the single emitter (`target=document`). */
  private enqueueDocumentDiff(): void {
    this.enqueue(async () => {
      try {
        const mapped = (await this.page.evaluate('window.__speculumDomMapDocument()')) as {
          generation?: number;
          root: DomNodeJson;
        };
        if (!mapped?.root) return;
        if (typeof mapped.generation === 'number') this.generation = mapped.generation;
        await this.materializeAndPush('dom', 'diff', 'document', { nodes: [mapped.root] });
      } catch {
        /* ignore */
      }
    });
  }

  private emitFromPage(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as {
      generation?: number;
      nodes?: DomNodeJson[];
      urls?: string[];
    };
    const pageKind = Array.isArray(p.urls) ? 'cssom' : Array.isArray(p.nodes) ? 'diff' : undefined;
    if (typeof p.generation === 'number' && p.generation !== this.generation) {
      const fromGeneration = this.generation;
      this.generation = p.generation;
      this.events.onGenerationBumped?.({
        fromGeneration,
        toGeneration: p.generation,
        reason: 'page_emit_sync',
        diffKind: pageKind,
        url: this.page.url(),
      });
    } else if (typeof p.generation === 'number') {
      this.generation = p.generation;
    }

    if (Array.isArray(p.urls) && p.urls.length) {
      const body: DomDiffBody = { urls: p.urls };
      this.enqueue(() => this.materializeAndPush('cssom', 'cssom', undefined, body));
      return;
    }

    if (!Array.isArray(p.nodes) || p.nodes.length === 0) return;
    const body: DomDiffBody = { nodes: p.nodes };
    this.enqueue(() => this.materializeAndPush('dom', 'diff', 'anchors', body));
  }

  private enqueue(work: () => Promise<void>): void {
    this.materializeChain = this.materializeChain.then(work).catch(() => {});
  }

  private async materializeAndPush(
    treeType: 'dom' | 'cssom',
    kind: 'diff' | 'cssom',
    target: 'document' | 'anchors' | undefined,
    body: DomDiffBody,
  ): Promise<void> {
    if (this.stopped) return;
    if ('urls' in body) {
      body.urls = body.urls.map((u) => {
        if (u.startsWith('/w7s/')) return u;
        if (u === '__inline__') return u;
        const key = virtualAssetKeyFromUrl(u);
        if (!key) return u;
        void this.kickFetch(u, key);
        return VIRTUAL_ASSETS_PREFIX + key;
      });
      this.push(treeType, kind, target, body);
      return;
    }
    await this.rewriteRemoteAssets(body);
    if (this.stopped) return;
    this.push(treeType, kind, target, body);
  }

  private async kickFetch(url: string, key: string): Promise<void> {
    try {
      if (isPassThroughUrl(url)) {
        this.assets.registerPassThrough(key, url);
        return;
      }
      const res = await this.page.context().request.get(url, { timeout: 10_000 });
      if (!res.ok()) return;
      const bufRaw = Buffer.from(await res.body());
      const headerCt = res.headers()['content-type'];
      let ct =
        (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim()
        || guessContentType(url)
        || 'application/octet-stream';
      let buf = bufRaw;
      if (ct.includes('text/css')) {
        const css = absolutizeCssUrls(bufRaw.toString('utf8'), url);
        const rewritten = rewriteCssUrlsToVirtual(css);
        buf = Buffer.from(rewritten, 'utf8');
      } else if (
        ct.includes('mpegurl')
        || ct.includes('dash+xml')
        || /\.m3u8(\?|$)/i.test(url)
        || /\.mpd(\?|$)/i.test(url)
      ) {
        buf = Buffer.from(rewriteManifestUrls(bufRaw.toString('utf8'), url), 'utf8');
        ct = ct.includes('dash') ? 'application/dash+xml' : 'application/vnd.apple.mpegurl';
      }
      if (isPassThroughUrl(url, ct)) {
        this.assets.registerPassThrough(key, url, ct);
        // Still cache a copy when small enough for warm serve.
        this.assets.put(key, buf, ct, { sourceUrl: url, mode: 'pass-through' });
      } else {
        this.assets.put(key, buf, ct, { sourceUrl: url, mode: 'cache' });
      }
    } catch {
      /* optional */
    }
  }

  private async rewriteRemoteAssets(body: Extract<DomDiffBody, { nodes: DomNodeJson[] }>): Promise<void> {
    type Candidate = { url: string; priority: number };
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    let pageBase = 'https://invalid.local/';
    try {
      pageBase = this.page.url() || pageBase;
    } catch {
      /* */
    }

    const absolutize = (raw: string): string => {
      const t = raw.trim();
      if (!t || t.startsWith('/w7s/') || t.startsWith('data:') || t.startsWith('blob:')) return t;
      if (/^https?:\/\//i.test(t)) return t;
      try {
        return new URL(t, pageBase).href;
      } catch {
        return t;
      }
    };

    const consider = (raw: string | undefined, tag?: string, attrs?: Record<string, string>) => {
      if (!raw || seen.has(raw)) return;
      if (raw.startsWith('/w7s/')) return;
      if (raw.startsWith('blob:') || raw.startsWith('data:')) {
        seen.add(raw);
        candidates.push({ url: raw, priority: 60 });
        return;
      }
      const url = absolutize(raw);
      if (seen.has(url)) return;
      if (!/^https?:\/\//i.test(url)) return;
      seen.add(raw);
      seen.add(url);
      candidates.push({ url, priority: assetFetchPriority(url, tag, attrs) });
    };

    const walk = (node: DomNodeJson | undefined) => {
      if (!node) return;
      if (node.attrs) {
        for (const key of ['href', 'src', 'poster', 'srcset', 'data-src', 'action', 'formaction'] as const) {
          const v = node.attrs[key];
          if (!v) continue;
          if (key === 'srcset') {
            for (const part of v.split(',')) {
              const u = part.trim().split(/\s+/)[0];
              consider(u, node.tag, node.attrs);
            }
          } else {
            consider(v, node.tag, node.attrs);
          }
        }
        if (node.attrs['style']) {
          for (const m of node.attrs['style'].matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) {
            consider(m[2], node.tag, node.attrs);
          }
        }
      }
      for (const child of node.children ?? []) walk(child);
    };

    for (const n of body.nodes) walk(n);

    const urlToVirtual = new Map<string, string>();
    for (const { url } of candidates) {
      if (url.startsWith('data:')) {
        const id = createInlineId(url);
        const parsed = parseDataUrl(url);
        if (parsed) {
          this.assets.putData(id, parsed.body, parsed.contentType);
        }
        urlToVirtual.set(url, VIRTUAL_DATA_PREFIX + id);
        continue;
      }
      if (url.startsWith('blob:')) {
        const id = createInlineId(url);
        urlToVirtual.set(url, VIRTUAL_BLOB_PREFIX + id);
        void this.ingestBlob(url, id);
        continue;
      }
      const key = virtualAssetKeyFromUrl(url);
      if (!key) continue;
      urlToVirtual.set(url, VIRTUAL_ASSETS_PREFIX + key);
    }

    // Also map original relative forms that absolutize to the same https URL.
    const rewriteLookup = (raw: string): string | undefined => {
      if (urlToVirtual.has(raw)) return urlToVirtual.get(raw);
      const abs = absolutize(raw);
      return urlToVirtual.get(abs);
    };

    candidates.sort((a, b) => b.priority - a.priority);
    const limited = candidates.slice(0, MAX_ASSET_FETCHES_PER_DIFF);
    for (const { url } of limited) {
      if (url.startsWith('data:') || url.startsWith('blob:')) continue;
      const key = virtualAssetKeyFromUrl(url);
      if (key) void this.kickFetch(url, key);
    }

    if (urlToVirtual.size === 0) return;

    const rewriteNode = (node: DomNodeJson | undefined) => {
      if (!node?.attrs) return;
      for (const key of Object.keys(node.attrs)) {
        const v = node.attrs[key];
        if (!v) continue;
        if (key === 'srcset') {
          node.attrs[key] = v
            .split(',')
            .map((part) => {
              const bits = part.trim().split(/\s+/);
              const u = bits[0]!;
              const mapped = rewriteLookup(u);
              if (mapped) bits[0] = mapped;
              return bits.join(' ');
            })
            .join(', ');
          continue;
        }
        const mapped = rewriteLookup(v);
        if (mapped) node.attrs[key] = mapped;
        if (key === 'style') {
          node.attrs[key] = v.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, q, raw) => {
            const m = rewriteLookup(raw);
            return m ? `url(${q}${m}${q})` : full;
          });
        }
      }
      for (const child of node.children ?? []) rewriteNode(child);
    };

    for (const n of body.nodes) rewriteNode(n);
  }

  private async ingestBlob(blobUrl: string, id: string): Promise<void> {
    try {
      const hit = await this.page.evaluate(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const ct = res.headers.get('content-type') || 'application/octet-stream';
          const buf = new Uint8Array(await res.arrayBuffer());
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < buf.length; i += chunk) {
            binary += String.fromCharCode(...buf.subarray(i, i + chunk));
          }
          return { contentType: ct, base64: btoa(binary) };
        } catch {
          return null;
        }
      }, blobUrl);
      if (!hit?.base64) return;
      this.assets.putBlob(id, Buffer.from(hit.base64, 'base64'), hit.contentType);
    } catch {
      /* optional */
    }
  }

  private push(
    treeType: 'dom' | 'cssom',
    kind: 'diff' | 'cssom',
    target: 'document' | 'anchors' | undefined,
    body: DomDiffBody,
  ): void {
    this.sequence += 1;
    this.events.onDomDiff({
      sequence: this.sequence,
      generation: this.generation,
      treeType,
      kind,
      target,
      timestampMs: Date.now(),
      body: encodeDomBody(body),
    });
  }
}

function createInlineId(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 24);
}

function parseDataUrl(url: string): { body: Buffer; contentType: string } | null {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!m) return null;
  const contentType = m[1] || 'application/octet-stream';
  const b64 = !!m[2];
  const data = m[3] ?? '';
  try {
    const body = b64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
    return { body, contentType };
  } catch {
    return null;
  }
}

function rewriteCssUrlsToVirtual(css: string): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/')) return match;
    if (!/^https?:\/\//i.test(trimmed)) return match;
    const key = virtualAssetKeyFromUrl(trimmed);
    if (!key) return match;
    return `url(${quote}${VIRTUAL_ASSETS_PREFIX}${key}${quote})`;
  });
}

function rewriteManifestUrls(body: string, baseUrl: string): string {
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        // Rewrite URI="..." inside HLS tags.
        return line.replace(/URI="([^"]+)"/gi, (_m, raw: string) => {
          try {
            const abs = new URL(raw, baseUrl).href;
            const key = virtualAssetKeyFromUrl(abs);
            return key ? `URI="${VIRTUAL_ASSETS_PREFIX}${key}"` : _m;
          } catch {
            return _m;
          }
        });
      }
      try {
        const abs = new URL(trimmed, baseUrl).href;
        const key = virtualAssetKeyFromUrl(abs);
        return key ? `${VIRTUAL_ASSETS_PREFIX}${key}` : line;
      } catch {
        return line;
      }
    })
    .join('\n');
}

function assetFetchPriority(
  url: string,
  tag: string | undefined,
  attrs: Record<string, string> | undefined,
): number {
  const rel = (attrs?.rel ?? '').toLowerCase();
  if (tag === 'link' && (rel.includes('stylesheet') || /\.css(\?|$)/i.test(url))) return 100;
  if (/\.css(\?|$)/i.test(url)) return 90;
  if (tag === 'img') return 50;
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) return 40;
  if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url)) return 20;
  if (isPassThroughUrl(url)) return 30;
  return 10;
}

function absolutizeCssUrls(css: string, baseUrl: string): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (
      !trimmed
      || trimmed.startsWith('data:')
      || trimmed.startsWith('http://')
      || trimmed.startsWith('https://')
      || trimmed.startsWith('/w7s/')
    ) {
      return match;
    }
    try {
      return `url(${quote}${new URL(trimmed, baseUrl).href}${quote})`;
    } catch {
      return match;
    }
  });
}

function guessContentType(url: string): string | null {
  const path = url.split('?')[0]!.toLowerCase();
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.woff')) return 'font/woff';
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  return null;
}

/** Optional CDP Fetch hook — do not enable alongside Navigation Fetch.guard. */
export async function attachDomAssetFetch(
  cdp: CDPSession,
  _put: (body: Buffer, contentType: string) => string | null,
): Promise<() => Promise<void>> {
  return async () => {
    void cdp;
  };
}
