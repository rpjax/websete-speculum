/**
 * Virtual-asset URL forms + CSS/manifest rewrite helpers (virtual-assets.md).
 */

import { createHash } from 'node:crypto';
import { isPassThroughUrl, virtualAssetKeyFromUrl } from '../../../patchright/mirror/dom/DomAssetCache';
import { mapSrcset } from '../../../patchright/mirror/dom/srcsetParse';

export const VIRTUAL_ASSETS_PREFIX = '/w7s/virtual-assets/';
export const VIRTUAL_BLOB_PREFIX = '/w7s/virtual-blob/';
export const VIRTUAL_DATA_PREFIX = '/w7s/virtual-data/';

/** DOM attribute names that carry fetchable URLs (case-insensitive). */
export const URL_ATTR_NAMES = new Set([
  'src',
  'href',
  'xlink:href',
  'data-src',
  'poster',
  'srcset',
  'imagesrcset',
  'style',
]);

export function createInlineId(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 24);
}

export function parseDataUrl(url: string): { body: Buffer; contentType: string } | null {
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

export function absolutizeUrl(raw: string, pageBase: string): string {
  const t = raw.trim();
  if (!t || t.startsWith('/w7s/') || t.startsWith('data:') || t.startsWith('blob:')) return t;
  if (/^https?:\/\//i.test(t)) return t;
  try {
    return new URL(t, pageBase).href;
  } catch {
    return t;
  }
}

export function guessContentType(url: string): string | null {
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
  if (path.endsWith('.mpd')) return 'application/dash+xml';
  return null;
}

export function isManifestUrl(url: string, contentType?: string): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('mpegurl') || ct.includes('dash+xml')) return true;
  return /\.m3u8(\?|$)/i.test(url) || /\.mpd(\?|$)/i.test(url);
}

/** Map http(s) absolute URL → `/w7s/virtual-assets/{host}{path}?query`. */
export function httpUrlToVirtual(url: string): string | null {
  const key = virtualAssetKeyFromUrl(url);
  if (!key) return null;
  // Ban bare-root `/w7s/virtual-assets/{host}/` without a real path segment beyond host.
  const slash = key.indexOf('/');
  if (slash <= 0 || slash === key.length - 1) return null;
  return VIRTUAL_ASSETS_PREFIX + key;
}

export function rewriteCssUrlsToVirtual(css: string): string {
  let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/')) return match;
    if (!/^https?:\/\//i.test(trimmed)) return match;
    const virtual = httpUrlToVirtual(trimmed);
    if (!virtual) return match;
    return `url(${quote}${virtual}${quote})`;
  });
  // Bare-string @import "…" / '…' (engine fetches; fold to virtual prefix).
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/')) return match;
    if (!/^https?:\/\//i.test(trimmed)) return match;
    const virtual = httpUrlToVirtual(trimmed);
    return virtual ? `@import ${quote}${virtual}${quote}` : match;
  });
  // image-set(…) — depth-aware (url() contains ')'); rewrite remaining http(s) tokens.
  out = rewriteImageSetHttpUrls(out);
  return out;
}

/** Rewrite bare/quoted http(s) URLs inside image-set(...), respecting nested parentheses. */
export function rewriteImageSetHttpUrls(css: string): string {
  return mapImageSetInners(css, (inner) =>
    inner.replace(/(['"]?)(https?:\/\/[^'")\s]+)\1/gi, (m, q: string, u: string) => {
      const virtual = httpUrlToVirtual(u);
      return virtual ? `${q}${virtual}${q}` : m;
    }),
  );
}

function mapImageSetInners(css: string, mapInner: (inner: string) => string): string {
  const needle = 'image-set(';
  let out = '';
  let i = 0;
  const lower = css.toLowerCase();
  while (i < css.length) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, idx);
    const openKw = css.slice(idx, idx + needle.length);
    const start = idx + needle.length;
    let depth = 1;
    let j = start;
    while (j < css.length && depth > 0) {
      const c = css[j]!;
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    if (depth !== 0) {
      out += css.slice(idx);
      break;
    }
    const inner = css.slice(start, j - 1);
    out += `${openKw}${mapInner(inner)})`;
    i = j;
  }
  return out;
}

export function absolutizeCssUrls(css: string, baseUrl: string): string {
  let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (
      !trimmed ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/w7s/')
    ) {
      return match;
    }
    try {
      return `url(${quote}${new URL(trimmed, baseUrl).href}${quote})`;
    } catch {
      return match;
    }
  });
  // Bare-string @import "./x.css" — engine fetches; must absolutize before virtual rewrite
  // or the Projected document resolves against Speculum origin without auth.
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (
      !trimmed ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/w7s/')
    ) {
      return match;
    }
    try {
      return `@import ${quote}${new URL(trimmed, baseUrl).href}${quote}`;
    } catch {
      return match;
    }
  });
  return out;
}

export function rewriteManifestUrls(body: string, baseUrl: string): string {
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_m, raw: string) => {
          try {
            const abs = new URL(raw, baseUrl).href;
            const virtual = httpUrlToVirtual(abs);
            return virtual ? `URI="${virtual}"` : _m;
          } catch {
            return _m;
          }
        });
      }
      try {
        const abs = new URL(trimmed, baseUrl).href;
        const virtual = httpUrlToVirtual(abs);
        return virtual ?? line;
      } catch {
        return line;
      }
    })
    .join('\n');
}

export type RewriteUrlResult =
  | { kind: 'unchanged'; value: string }
  | { kind: 'http'; value: string; sourceUrl: string; key: string; passThrough: boolean }
  | { kind: 'data'; value: string; id: string; body: Buffer; contentType: string }
  | { kind: 'blob'; value: string; id: string; sourceUrl: string }
  | { kind: 'deny'; value: string };

/**
 * Rewrite one URL string against page base. Does not materialize — caller does.
 */
export function classifyAndRewriteUrl(raw: string, pageBase: string): RewriteUrlResult {
  const t = raw.trim();
  if (!t || t.startsWith('/w7s/')) return { kind: 'unchanged', value: raw };
  if (/^(javascript|about|mailto|tel):/i.test(t)) return { kind: 'deny', value: '' };
  if (t.startsWith('data:')) {
    const id = createInlineId(t);
    const parsed = parseDataUrl(t);
    if (!parsed) return { kind: 'deny', value: '' };
    return {
      kind: 'data',
      value: VIRTUAL_DATA_PREFIX + id,
      id,
      body: parsed.body,
      contentType: parsed.contentType,
    };
  }
  if (t.startsWith('blob:')) {
    const id = createInlineId(t);
    return { kind: 'blob', value: VIRTUAL_BLOB_PREFIX + id, id, sourceUrl: t };
  }
  const abs = absolutizeUrl(t, pageBase);
  if (!/^https?:\/\//i.test(abs)) return { kind: 'unchanged', value: raw };
  const key = virtualAssetKeyFromUrl(abs);
  const virtual = httpUrlToVirtual(abs);
  if (!key || !virtual) return { kind: 'unchanged', value: raw };
  return {
    kind: 'http',
    value: virtual,
    sourceUrl: abs,
    key,
    passThrough: isPassThroughUrl(abs),
  };
}

/** Rewrite a single attr value (plain URL, srcset, or style cssText). */
export function rewriteAttrValue(
  name: string,
  value: string,
  pageBase: string,
  onRewrite: (result: RewriteUrlResult) => void,
): string {
  const lower = name.toLowerCase();
  if (lower === 'srcset' || lower === 'imagesrcset') {
    return mapSrcset(value, (u) => {
      const r = classifyAndRewriteUrl(u, pageBase);
      onRewrite(r);
      return r.kind === 'deny' ? '' : r.value;
    });
  }
  if (lower === 'style') {
    return rewriteCssText(value, pageBase, onRewrite);
  }
  const r = classifyAndRewriteUrl(value, pageBase);
  onRewrite(r);
  return r.kind === 'deny' ? '' : r.value;
}

export function rewriteCssText(
  css: string,
  pageBase: string,
  onRewrite: (result: RewriteUrlResult) => void,
): string {
  const abs = absolutizeCssUrls(css, pageBase);
  // Collect http(s) urls for materialize, then rewrite to virtual.
  abs.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_m, _q, raw: string) => {
    const r = classifyAndRewriteUrl(raw.trim(), pageBase);
    onRewrite(r);
    return _m;
  });
  abs.replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, _q, raw: string) => {
    const r = classifyAndRewriteUrl(raw.trim(), pageBase);
    onRewrite(r);
    return _m;
  });
  return rewriteCssUrlsToVirtual(abs);
}

export { isPassThroughUrl, virtualAssetKeyFromUrl, mapSrcset };
