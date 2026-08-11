"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UrlRewriter = void 0;
const srcsetParse_1 = require("../../dom/srcsetParse");
const fmap_1 = require("../fmap");
function isAlreadyRewritten(url) {
    return url.startsWith(fmap_1.VIRTUAL_ASSETS_PREFIX) || url.startsWith(fmap_1.VIRTUAL_BLOB_PREFIX) || url.startsWith(fmap_1.VIRTUAL_DATA_PREFIX);
}
function isJavascriptUrl(url) {
    return /^\s*javascript:/i.test(url);
}
class UrlRewriter {
    options;
    memo = new Map();
    constructor(options) {
        this.options = options;
    }
    get memoSize() {
        return this.memo.size;
    }
    /** §5.2.4 — `{scheme,host,path,query}` → `/w7s/virtual-assets/{host}{path}?{query}`. */
    rewriteUrl(rawUrl, baseHref) {
        if (!rawUrl)
            return rawUrl;
        const cached = this.memo.get(rawUrl);
        if (cached !== undefined)
            return cached;
        const rewritten = this.computeRewrite(rawUrl, baseHref);
        this.memo.set(rawUrl, rewritten);
        return rewritten;
    }
    computeRewrite(rawUrl, baseHref) {
        if (isJavascriptUrl(rawUrl))
            return rawUrl; // deny-listed upstream (fmap); never rewritten here.
        if (rawUrl.startsWith('data:'))
            return rawUrl; // inline; no origin fetch to rewrite.
        if (isAlreadyRewritten(rawUrl))
            return rawUrl;
        let absolute;
        try {
            absolute = new URL(rawUrl, baseHref ?? `https://${this.options.originHost}/`);
        }
        catch {
            return rawUrl;
        }
        if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:')
            return rawUrl;
        return `${fmap_1.VIRTUAL_ASSETS_PREFIX}${absolute.host}${absolute.pathname}${absolute.search}`;
    }
    /** §5.2.4 — covers `src`/`href`/`xlink:href`/`data-src`/`poster`/`srcset`/`imagesrcset`. */
    rewriteAttrValue(attrName, value, baseHref) {
        const name = attrName.toLowerCase();
        if (!fmap_1.URL_REWRITE_ATTRS.has(name))
            return value;
        if (name === 'srcset' || name === 'imagesrcset')
            return this.rewriteSrcset(value, baseHref);
        return this.rewriteUrl(value, baseHref);
    }
    rewriteSrcset(value, baseHref) {
        return (0, srcsetParse_1.mapSrcset)(value, (url) => this.rewriteUrl(url, baseHref));
    }
    /** Bare-string CSS forms: `@import "url"` and `url(...)` (§5.2.4), fixing the bare-root 404 class (D7) by construction. */
    rewriteCssUrlFunctions(cssText, baseHref) {
        return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_match, quote, url) => {
            const rewritten = this.rewriteUrl(url, baseHref);
            return `url(${quote}${rewritten}${quote})`;
        });
    }
}
exports.UrlRewriter = UrlRewriter;
//# sourceMappingURL=rewrite.js.map