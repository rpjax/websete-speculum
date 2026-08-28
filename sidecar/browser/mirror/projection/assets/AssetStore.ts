/**
 * Session L1 asset store — fill, pass-through, blob/data, getAsset (virtual-assets.md).
 */

import type { Page } from 'patchright';
import {
  DomAssetCache,
  isPassThroughUrl,
  type DomAssetShareability,
  virtualAssetKeyFromUrl,
} from '../../../patchright/mirror/dom/DomAssetCache';
import {
  absolutizeCssUrls,
  guessContentType,
  isManifestUrl,
  rewriteCssUrlsToVirtual,
  rewriteManifestUrls,
  type RewriteUrlResult,
  VIRTUAL_ASSETS_PREFIX,
} from './urlForms';

export type DomAssetServeResult = {
  body: Uint8Array;
  contentType: string;
  statusCode?: number;
  contentRange?: string;
  passThrough?: boolean;
  requestHadCookie?: boolean;
  requestHadAuthorization?: boolean;
  cacheControl?: string;
  vary?: string;
};

const FILL_TIMEOUT_MS = 10_000;
const PASS_THROUGH_TIMEOUT_MS = 30_000;
const AWAIT_FILL_MS = 8_000;

export class AssetStore {
  private readonly cache = new DomAssetCache();
  private readonly inFlight = new Map<string, Promise<void>>();
  private page: Page | null = null;
  private stopped = false;

  bindPage(page: Page | null): void {
    this.page = page;
  }

  clear(): void {
    this.stopped = true;
    this.cache.clear();
    this.inFlight.clear();
    this.stopped = false;
  }

  /** Side-effect from rewrite hop — kick materialize without blocking the frame. */
  materializeRewrite(result: RewriteUrlResult): void {
    if (result.kind === 'unchanged' || result.kind === 'deny') return;
    if (result.kind === 'data') {
      this.cache.putData(result.id, result.body, result.contentType);
      return;
    }
    if (result.kind === 'blob') {
      void this.ingestBlob(result.sourceUrl, result.id);
      return;
    }
    // http
    if (result.passThrough) {
      this.cache.registerPassThrough(result.key, result.sourceUrl);
      // Still kick a warm fill for small media / manifests when useful.
    }
    void this.kickFill(result.sourceUrl, result.key);
  }

  async getAsset(
    key: string,
    opts?: { kind?: string; rangeHeader?: string },
  ): Promise<DomAssetServeResult | null> {
    if (!key) return null;
    let lookup = key;
    const kind = (opts?.kind ?? '').toLowerCase();
    if (kind === 'blob') lookup = key.startsWith('_blob/') ? key : `_blob/${key}`;
    else if (kind === 'data') lookup = key.startsWith('_data/') ? key : `_data/${key}`;

    const rangeHeader = opts?.rangeHeader;
    const hit = this.cache.get(lookup);

    if (hit && hit.body.byteLength > 0 && hit.mode === 'cache' && !rangeHeader) {
      return {
        body: hit.body,
        contentType: hit.contentType,
        statusCode: 200,
        ...shareabilityFields(hit.shareability),
      };
    }

    if (hit?.mode === 'pass-through' || rangeHeader || (hit && hit.body.byteLength === 0)) {
      const pt = await this.fetchPassThrough(lookup, rangeHeader);
      if (!pt) {
        return hit && hit.body.byteLength > 0
          ? { body: hit.body, contentType: hit.contentType, statusCode: 200 }
          : null;
      }
      return {
        body: pt.body,
        contentType: pt.contentType,
        statusCode: pt.statusCode,
        contentRange: pt.contentRange,
        passThrough: true,
      };
    }

    if (hit && hit.body.byteLength > 0) {
      return { body: hit.body, contentType: hit.contentType, statusCode: 200 };
    }

    // Warm miss: await in-flight fill, then recheck.
    const pending = this.inFlight.get(lookup);
    if (pending) {
      await Promise.race([pending, sleep(AWAIT_FILL_MS)]);
      const after = this.cache.get(lookup);
      if (after && after.body.byteLength > 0 && after.mode === 'cache') {
        return {
          body: after.body,
          contentType: after.contentType,
          statusCode: 200,
          ...shareabilityFields(after.shareability),
        };
      }
    }

    // Reconstruct https URL from key and try pass-through / fill.
    const pt = await this.fetchPassThrough(lookup, rangeHeader);
    if (!pt) return null;
    return {
      body: pt.body,
      contentType: pt.contentType,
      statusCode: pt.statusCode,
      contentRange: pt.contentRange,
      passThrough: true,
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
    const page = this.page;
    if (!page || this.stopped) return null;
    const e = this.cache.get(key);
    const sourceUrl = e?.sourceUrl ?? this.sourceUrlFromKey(key);
    try {
      const headers: Record<string, string> = {};
      if (rangeHeader) headers.Range = rangeHeader;
      const res = await page.context().request.get(sourceUrl, {
        timeout: PASS_THROUGH_TIMEOUT_MS,
        headers,
      });
      if (!res.ok() && res.status() !== 206) return null;
      let body = Buffer.from(await res.body());
      const headerCt = res.headers()['content-type'];
      let contentType =
        (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim() ||
        guessContentType(sourceUrl) ||
        'application/octet-stream';

      if (isManifestUrl(sourceUrl, contentType) && !rangeHeader) {
        body = Buffer.from(rewriteManifestUrls(body.toString('utf8'), sourceUrl), 'utf8');
        contentType = contentType.includes('dash')
          ? 'application/dash+xml'
          : 'application/vnd.apple.mpegurl';
        // Cache rewritten manifest for subsequent GETs (short; L1 FIFO).
        this.cache.put(key, body, contentType, { sourceUrl, mode: 'cache' });
        // Segment URLs inside need pass-through registration — kick from rewritten lines.
        this.registerManifestSegmentPassThroughs(body.toString('utf8'), sourceUrl);
      }

      const contentRange = res.headers()['content-range'];
      return {
        body,
        contentType,
        statusCode: res.status(),
        contentRange: typeof contentRange === 'string' ? contentRange : contentRange?.[0],
      };
    } catch {
      return null;
    }
  }

  private kickFill(url: string, key: string): Promise<void> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const work = this.fillOnce(url, key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, work);
    return work;
  }

  private async fillOnce(url: string, key: string): Promise<void> {
    const page = this.page;
    if (!page || this.stopped) return;
    try {
      if (isPassThroughUrl(url) && !isManifestUrl(url)) {
        this.cache.registerPassThrough(key, url);
        return;
      }
      const res = await page.context().request.get(url, { timeout: FILL_TIMEOUT_MS });
      if (!res.ok()) return;
      const bufRaw = Buffer.from(await res.body());
      const headerCt = res.headers()['content-type'];
      let ct =
        (typeof headerCt === 'string' ? headerCt : headerCt?.[0])?.split(';')[0]?.trim() ||
        guessContentType(url) ||
        'application/octet-stream';
      let buf = bufRaw;
      if (ct.includes('text/css')) {
        const css = absolutizeCssUrls(bufRaw.toString('utf8'), url);
        const rewritten = rewriteCssUrlsToVirtual(css);
        buf = Buffer.from(rewritten, 'utf8');
        this.kickNestedVirtualAssetRefs(rewritten, url);
      } else if (isManifestUrl(url, ct)) {
        buf = Buffer.from(rewriteManifestUrls(bufRaw.toString('utf8'), url), 'utf8');
        ct = ct.includes('dash') ? 'application/dash+xml' : 'application/vnd.apple.mpegurl';
        this.registerManifestSegmentPassThroughs(buf.toString('utf8'), url);
      }

      const shareability = await this.captureShareability(page, url, res.headers());

      if (isPassThroughUrl(url, ct) && !isManifestUrl(url, ct)) {
        this.cache.registerPassThrough(key, url, ct);
        this.cache.put(key, buf, ct, { sourceUrl: url, mode: 'pass-through', shareability });
      } else {
        this.cache.put(key, buf, ct, { sourceUrl: url, mode: 'cache', shareability });
      }
    } catch {
      /* optional warm fill */
    }
  }

  /**
   * CSS fill rewrites nested url()/@import to `/w7s/virtual-assets/…` in the cached body.
   * Kick L1 fill for those keys too — otherwise the Projected browser GETs them cold and the
   * scheme-less key fallback may miss (lab http fixtures).
   */
  private kickNestedVirtualAssetRefs(css: string, baseUrl: string): void {
    const re = /\/w7s\/virtual-assets\/([^\s'")]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      const key = m[1]!;
      if (!key || key.includes('speculum-session-token')) continue;
      const sourceUrl = this.sourceUrlFromKey(key, baseUrl);
      if (!sourceUrl) continue;
      this.cache.registerPassThrough(key, sourceUrl);
      void this.kickFill(sourceUrl, key);
    }
  }

  /** Rebuild remote URL from L1 key; prefer scheme of `hintUrl` or the bound page. */
  private sourceUrlFromKey(key: string, hintUrl?: string): string {
    if (key.includes('://')) return key;
    let protocol = 'https:';
    const hint = hintUrl || this.page?.url() || '';
    try {
      if (hint) protocol = new URL(hint).protocol || protocol;
    } catch {
      /* keep https */
    }
    if (protocol !== 'http:' && protocol !== 'https:') protocol = 'https:';
    return `${protocol}//${key}`;
  }

  private registerManifestSegmentPassThroughs(manifest: string, baseUrl: string): void {
    for (const line of manifest.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        const uri = /URI="([^"]+)"/i.exec(trimmed);
        if (uri?.[1]) {
          try {
            const abs = new URL(uri[1], baseUrl).href;
            const key = virtualAssetKeyFromUrl(abs);
            if (key) this.cache.registerPassThrough(key, abs);
          } catch {
            /* */
          }
        }
        continue;
      }
      if (trimmed.startsWith(VIRTUAL_ASSETS_PREFIX)) {
        const key = trimmed.slice(VIRTUAL_ASSETS_PREFIX.length);
        const abs = this.sourceUrlFromKey(key, baseUrl);
        this.cache.registerPassThrough(key, abs);
        continue;
      }
      try {
        const abs = new URL(trimmed, baseUrl).href;
        const key = virtualAssetKeyFromUrl(abs);
        if (key) this.cache.registerPassThrough(key, abs);
      } catch {
        /* */
      }
    }
  }

  private async ingestBlob(blobUrl: string, id: string): Promise<void> {
    const page = this.page;
    if (!page || this.stopped) return;
    try {
      const hit = await page.evaluate(async (url) => {
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
      this.cache.putBlob(id, Buffer.from(hit.base64, 'base64'), hit.contentType);
    } catch {
      /* optional */
    }
  }

  private async captureShareability(
    page: Page,
    url: string,
    headers: Record<string, string | string[] | undefined> | { [key: string]: string },
  ): Promise<DomAssetShareability> {
    let requestHadCookie = false;
    try {
      const cookies = await page.context().cookies(url);
      requestHadCookie = cookies.length > 0;
    } catch {
      requestHadCookie = false;
    }
    const cacheControl = headerOne(headers, 'cache-control');
    const vary = headerOne(headers, 'vary');
    return { requestHadCookie, cacheControl, vary };
  }
}

function headerOne(
  headers: Record<string, string | string[] | undefined> | { [key: string]: string },
  name: string,
): string | undefined {
  const v = (headers as Record<string, string | string[] | undefined>)[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

function shareabilityFields(s?: DomAssetShareability): {
  requestHadCookie?: boolean;
  requestHadAuthorization?: boolean;
  cacheControl?: string;
  vary?: string;
} {
  if (!s) return {};
  return {
    requestHadCookie: s.requestHadCookie,
    requestHadAuthorization: s.requestHadAuthorization,
    cacheControl: s.cacheControl,
    vary: s.vary,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
