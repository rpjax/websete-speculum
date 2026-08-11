import { mapSrcset } from '../../dom/srcsetParse';
import { URL_REWRITE_ATTRS, VIRTUAL_ASSETS_PREFIX, VIRTUAL_BLOB_PREFIX, VIRTUAL_DATA_PREFIX } from '../fmap';

/**
 * §5.2.4 — Node-side URL rewriting. One `UrlRewriter` per session; the memo
 * is an **instance field**, never shared across sessions (K2).
 */

export type RewriteOptions = {
  /** Virtual page's own host, used to resolve relative URLs. */
  originHost: string;
};

function isAlreadyRewritten(url: string): boolean {
  return url.startsWith(VIRTUAL_ASSETS_PREFIX) || url.startsWith(VIRTUAL_BLOB_PREFIX) || url.startsWith(VIRTUAL_DATA_PREFIX);
}

function isJavascriptUrl(url: string): boolean {
  return /^\s*javascript:/i.test(url);
}

export class UrlRewriter {
  private readonly memo = new Map<string, string>();

  constructor(private readonly options: RewriteOptions) {}

  get memoSize(): number {
    return this.memo.size;
  }

  /** §5.2.4 — `{scheme,host,path,query}` → `/w7s/virtual-assets/{host}{path}?{query}`. */
  rewriteUrl(rawUrl: string, baseHref?: string): string {
    if (!rawUrl) return rawUrl;
    const cached = this.memo.get(rawUrl);
    if (cached !== undefined) return cached;
    const rewritten = this.computeRewrite(rawUrl, baseHref);
    this.memo.set(rawUrl, rewritten);
    return rewritten;
  }

  private computeRewrite(rawUrl: string, baseHref?: string): string {
    if (isJavascriptUrl(rawUrl)) return rawUrl; // deny-listed upstream (fmap); never rewritten here.
    if (rawUrl.startsWith('data:')) return rawUrl; // inline; no origin fetch to rewrite.
    if (isAlreadyRewritten(rawUrl)) return rawUrl;

    let absolute: URL;
    try {
      absolute = new URL(rawUrl, baseHref ?? `https://${this.options.originHost}/`);
    } catch {
      return rawUrl;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return rawUrl;
    return `${VIRTUAL_ASSETS_PREFIX}${absolute.host}${absolute.pathname}${absolute.search}`;
  }

  /** §5.2.4 — covers `src`/`href`/`xlink:href`/`data-src`/`poster`/`srcset`/`imagesrcset`. */
  rewriteAttrValue(attrName: string, value: string, baseHref?: string): string {
    const name = attrName.toLowerCase();
    if (!URL_REWRITE_ATTRS.has(name)) return value;
    if (name === 'srcset' || name === 'imagesrcset') return this.rewriteSrcset(value, baseHref);
    return this.rewriteUrl(value, baseHref);
  }

  private rewriteSrcset(value: string, baseHref?: string): string {
    return mapSrcset(value, (url) => this.rewriteUrl(url, baseHref));
  }

  /** Bare-string CSS forms: `@import "url"` and `url(...)` (§5.2.4), fixing the bare-root 404 class (D7) by construction. */
  rewriteCssUrlFunctions(cssText: string, baseHref?: string): string {
    return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_match, quote: string, url: string) => {
      const rewritten = this.rewriteUrl(url, baseHref);
      return `url(${quote}${rewritten}${quote})`;
    });
  }
}
