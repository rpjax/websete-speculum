/**
 * Live-session binding auth on the Projected client (virtual-assets.md §1.1).
 *
 * HTTP edges (`/w7s/virtual-*`) carry the binding token in the reserved query
 * parameter. Query surgery is done on the raw string — `URL`/`URLSearchParams`
 * would normalize percent-encoding and change the L1 key.
 */

export const SessionAuthQueryParam = 'speculum-session-token';
export const SessionCacheBustQueryParam = 'speculum-cache-bust';

/** True for URLs served by the virtual-asset serve plane. */
export function isVirtualAssetUrl(url: string): boolean {
  return url.startsWith('/w7s/virtual-') || url.includes('/virtual-');
}

/**
 * Absolutize against the API/lab origin and stamp the reserved auth parameter.
 * Idempotent. Non-virtual URLs are returned untouched.
 */
export function appendSessionAuth(url: string, token: string, assetBaseUrl = ''): string {
  if (!url || !token) return url;
  if (!isVirtualAssetUrl(url)) return url;
  const base = assetBaseUrl.replace(/\/$/, '');
  const absolute = url.startsWith('http')
    ? url
    : `${base}${url.startsWith('/') ? url : `/${url}`}`;
  return setReservedParam(absolute, SessionAuthQueryParam, token);
}

/** Force a fresh stylesheet fetch; reserved name is stripped server-side before key lookup. */
export function appendCacheBust(url: string, value: string | number): string {
  if (!url) return url;
  return setReservedParam(url, SessionCacheBustQueryParam, String(value));
}

/** Stamp sessionId + reserved binding token onto a URL (data-plane dial). */
export function appendSessionBindingQuery(url: URL, sessionId: string, token: string): URL {
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set(SessionAuthQueryParam, token);
  return url;
}

function setReservedParam(url: string, name: string, value: string): string {
  const hashAt = url.indexOf('#');
  const fragment = hashAt >= 0 ? url.slice(hashAt) : '';
  const withoutFragment = hashAt >= 0 ? url.slice(0, hashAt) : url;

  const queryAt = withoutFragment.indexOf('?');
  const path = queryAt >= 0 ? withoutFragment.slice(0, queryAt) : withoutFragment;
  const rawQuery = queryAt >= 0 ? withoutFragment.slice(queryAt + 1) : '';

  const lowered = name.toLowerCase();
  const kept = rawQuery
    .split('&')
    .filter((part) => part.length > 0)
    .filter((part) => {
      const eq = part.indexOf('=');
      const key = eq >= 0 ? part.slice(0, eq) : part;
      return key.toLowerCase() !== lowered;
    });

  kept.push(`${name}=${encodeURIComponent(value)}`);
  return `${path}?${kept.join('&')}${fragment}`;
}

/** Stamp every virtual-asset URL token inside srcset / imagesrcset. */
export function stampSrcsetAuth(value: string, token: string, assetBaseUrl: string): string {
  if (!token || !value) return value;
  // Coarse: rewrite each candidate URL (WHATWG-ish — URL until whitespace).
  return value
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const bits = trimmed.split(/\s+/);
      const u = bits[0]!;
      const rest = bits.slice(1).join(' ');
      const stamped = appendSessionAuth(u, token, assetBaseUrl);
      return rest ? `${stamped} ${rest}` : stamped;
    })
    .join(', ');
}

/** Stamp virtual URLs inside cssText / style (url(), @import, image-set). */
export function stampCssTextAuth(css: string, token: string, assetBaseUrl: string): string {
  if (!token || !css) return css;
  let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    if (!isVirtualAssetUrl(raw)) return match;
    return `url(${quote}${appendSessionAuth(raw, token, assetBaseUrl)}${quote})`;
  });
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, raw: string) => {
    if (!isVirtualAssetUrl(raw)) return match;
    return `@import ${quote}${appendSessionAuth(raw, token, assetBaseUrl)}${quote}`;
  });
  out = mapImageSetInners(out, (inner) =>
    inner.replace(
      /(['"]?)(\/?w7s\/virtual-[^'")\s]+|https?:\/\/[^'")\s]*\/virtual-[^'")\s]+)\1/gi,
      (m, q: string, u: string) => {
        if (!isVirtualAssetUrl(u)) return m;
        return `${q}${appendSessionAuth(u, token, assetBaseUrl)}${q}`;
      },
    ),
  );
  return out;
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

/**
 * Serve-time stamp: CSS / HLS / DASH bodies embed `/w7s/virtual-*` without auth.
 * The browser fetches those nested URLs itself — stamp the request token into the body.
 */
export function stampAuthInServedBody(body: string, contentType: string, token: string): string {
  if (!token || !body) return body;
  const ct = contentType.toLowerCase();
  if (ct.includes('text/css')) return stampCssTextAuth(body, token, '');
  if (
    ct.includes('mpegurl') ||
    ct.includes('dash+xml') ||
    ct.includes('x-mpegurl') ||
    ct.includes('apple.mpegurl')
  ) {
    return stampManifestAuth(body, token);
  }
  return body;
}

function stampManifestAuth(body: string, token: string): string {
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_m, raw: string) => {
          if (!isVirtualAssetUrl(raw)) return _m;
          return `URI="${appendSessionAuth(raw, token, '')}"`;
        });
      }
      if (!isVirtualAssetUrl(trimmed)) return line;
      // Preserve leading whitespace of the original line if any.
      const lead = line.match(/^\s*/)?.[0] ?? '';
      return lead + appendSessionAuth(trimmed, token, '');
    })
    .join('\n');
}

const URL_ATTR_STAMP = new Set([
  'src',
  'href',
  'xlink:href',
  'data-src',
  'poster',
  'srcset',
  'imagesrcset',
  'style',
]);

/** Stamp one attr value if it is a virtual-asset sink. */
export function stampAttrAuth(
  name: string,
  value: string,
  token: string,
  assetBaseUrl: string,
): string {
  if (!token || !value) return value;
  const lower = name.toLowerCase();
  if (!URL_ATTR_STAMP.has(lower)) return value;
  if (lower === 'srcset' || lower === 'imagesrcset') {
    return stampSrcsetAuth(value, token, assetBaseUrl);
  }
  if (lower === 'style') {
    return stampCssTextAuth(value, token, assetBaseUrl);
  }
  return appendSessionAuth(value, token, assetBaseUrl);
}
