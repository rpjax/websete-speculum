"use strict";
/**
 * Virtual-asset URL forms + CSS/manifest rewrite helpers (virtual-assets.md).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapSrcset = exports.virtualAssetKeyFromUrl = exports.isPassThroughUrl = exports.URL_ATTR_NAMES = exports.VIRTUAL_DATA_PREFIX = exports.VIRTUAL_BLOB_PREFIX = exports.VIRTUAL_ASSETS_PREFIX = void 0;
exports.createInlineId = createInlineId;
exports.parseDataUrl = parseDataUrl;
exports.absolutizeUrl = absolutizeUrl;
exports.guessContentType = guessContentType;
exports.isManifestUrl = isManifestUrl;
exports.httpUrlToVirtual = httpUrlToVirtual;
exports.rewriteCssUrlsToVirtual = rewriteCssUrlsToVirtual;
exports.rewriteImageSetHttpUrls = rewriteImageSetHttpUrls;
exports.absolutizeCssUrls = absolutizeCssUrls;
exports.rewriteManifestUrls = rewriteManifestUrls;
exports.classifyAndRewriteUrl = classifyAndRewriteUrl;
exports.rewriteAttrValue = rewriteAttrValue;
exports.rewriteCssText = rewriteCssText;
const node_crypto_1 = require("node:crypto");
const DomAssetCache_1 = require("../../../patchright/mirror/dom/DomAssetCache");
Object.defineProperty(exports, "isPassThroughUrl", { enumerable: true, get: function () { return DomAssetCache_1.isPassThroughUrl; } });
Object.defineProperty(exports, "virtualAssetKeyFromUrl", { enumerable: true, get: function () { return DomAssetCache_1.virtualAssetKeyFromUrl; } });
const srcsetParse_1 = require("../../../patchright/mirror/dom/srcsetParse");
Object.defineProperty(exports, "mapSrcset", { enumerable: true, get: function () { return srcsetParse_1.mapSrcset; } });
exports.VIRTUAL_ASSETS_PREFIX = '/w7s/virtual-assets/';
exports.VIRTUAL_BLOB_PREFIX = '/w7s/virtual-blob/';
exports.VIRTUAL_DATA_PREFIX = '/w7s/virtual-data/';
/** DOM attribute names that carry fetchable URLs (case-insensitive). */
exports.URL_ATTR_NAMES = new Set([
    'src',
    'href',
    'xlink:href',
    'data-src',
    'poster',
    'srcset',
    'imagesrcset',
    'style',
]);
function createInlineId(s) {
    return (0, node_crypto_1.createHash)('sha256').update(s).digest('hex').slice(0, 24);
}
function parseDataUrl(url) {
    const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(url);
    if (!m)
        return null;
    const contentType = m[1] || 'application/octet-stream';
    const b64 = !!m[2];
    const data = m[3] ?? '';
    try {
        const body = b64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
        return { body, contentType };
    }
    catch {
        return null;
    }
}
function absolutizeUrl(raw, pageBase) {
    const t = raw.trim();
    if (!t || t.startsWith('/w7s/') || t.startsWith('data:') || t.startsWith('blob:'))
        return t;
    if (/^https?:\/\//i.test(t))
        return t;
    try {
        return new URL(t, pageBase).href;
    }
    catch {
        return t;
    }
}
function guessContentType(url) {
    const path = url.split('?')[0].toLowerCase();
    if (path.endsWith('.css'))
        return 'text/css';
    if (path.endsWith('.js'))
        return 'application/javascript';
    if (path.endsWith('.svg'))
        return 'image/svg+xml';
    if (path.endsWith('.png'))
        return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg'))
        return 'image/jpeg';
    if (path.endsWith('.webp'))
        return 'image/webp';
    if (path.endsWith('.woff2'))
        return 'font/woff2';
    if (path.endsWith('.woff'))
        return 'font/woff';
    if (path.endsWith('.mp4'))
        return 'video/mp4';
    if (path.endsWith('.webm'))
        return 'video/webm';
    if (path.endsWith('.m3u8'))
        return 'application/vnd.apple.mpegurl';
    if (path.endsWith('.mpd'))
        return 'application/dash+xml';
    return null;
}
function isManifestUrl(url, contentType) {
    const ct = (contentType ?? '').toLowerCase();
    if (ct.includes('mpegurl') || ct.includes('dash+xml'))
        return true;
    return /\.m3u8(\?|$)/i.test(url) || /\.mpd(\?|$)/i.test(url);
}
/** Map http(s) absolute URL → `/w7s/virtual-assets/{host}{path}?query`. */
function httpUrlToVirtual(url) {
    const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(url);
    if (!key)
        return null;
    // Ban bare-root `/w7s/virtual-assets/{host}/` without a real path segment beyond host.
    const slash = key.indexOf('/');
    if (slash <= 0 || slash === key.length - 1)
        return null;
    return exports.VIRTUAL_ASSETS_PREFIX + key;
}
function rewriteCssUrlsToVirtual(css) {
    let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/'))
            return match;
        if (!/^https?:\/\//i.test(trimmed))
            return match;
        const virtual = httpUrlToVirtual(trimmed);
        if (!virtual)
            return match;
        return `url(${quote}${virtual}${quote})`;
    });
    // Bare-string @import "…" / '…' (engine fetches; fold to virtual prefix).
    out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, raw) => {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('/w7s/'))
            return match;
        if (!/^https?:\/\//i.test(trimmed))
            return match;
        const virtual = httpUrlToVirtual(trimmed);
        return virtual ? `@import ${quote}${virtual}${quote}` : match;
    });
    // image-set(…) — depth-aware (url() contains ')'); rewrite remaining http(s) tokens.
    out = rewriteImageSetHttpUrls(out);
    return out;
}
/** Rewrite bare/quoted http(s) URLs inside image-set(...), respecting nested parentheses. */
function rewriteImageSetHttpUrls(css) {
    return mapImageSetInners(css, (inner) => inner.replace(/(['"]?)(https?:\/\/[^'")\s]+)\1/gi, (m, q, u) => {
        const virtual = httpUrlToVirtual(u);
        return virtual ? `${q}${virtual}${q}` : m;
    }));
}
function mapImageSetInners(css, mapInner) {
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
            const c = css[j];
            if (c === '(')
                depth++;
            else if (c === ')')
                depth--;
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
function absolutizeCssUrls(css, baseUrl) {
    let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
        const trimmed = raw.trim();
        if (!trimmed ||
            trimmed.startsWith('data:') ||
            trimmed.startsWith('http://') ||
            trimmed.startsWith('https://') ||
            trimmed.startsWith('/w7s/')) {
            return match;
        }
        try {
            return `url(${quote}${new URL(trimmed, baseUrl).href}${quote})`;
        }
        catch {
            return match;
        }
    });
    // Bare-string @import "./x.css" — engine fetches; must absolutize before virtual rewrite
    // or the Projected document resolves against Speculum origin without auth.
    out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, raw) => {
        const trimmed = raw.trim();
        if (!trimmed ||
            trimmed.startsWith('data:') ||
            trimmed.startsWith('http://') ||
            trimmed.startsWith('https://') ||
            trimmed.startsWith('/w7s/')) {
            return match;
        }
        try {
            return `@import ${quote}${new URL(trimmed, baseUrl).href}${quote}`;
        }
        catch {
            return match;
        }
    });
    return out;
}
function rewriteManifestUrls(body, baseUrl) {
    return body
        .split('\n')
        .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/gi, (_m, raw) => {
                try {
                    const abs = new URL(raw, baseUrl).href;
                    const virtual = httpUrlToVirtual(abs);
                    return virtual ? `URI="${virtual}"` : _m;
                }
                catch {
                    return _m;
                }
            });
        }
        try {
            const abs = new URL(trimmed, baseUrl).href;
            const virtual = httpUrlToVirtual(abs);
            return virtual ?? line;
        }
        catch {
            return line;
        }
    })
        .join('\n');
}
/**
 * Rewrite one URL string against page base. Does not materialize — caller does.
 */
function classifyAndRewriteUrl(raw, pageBase) {
    const t = raw.trim();
    if (!t || t.startsWith('/w7s/'))
        return { kind: 'unchanged', value: raw };
    if (/^(javascript|about|mailto|tel):/i.test(t))
        return { kind: 'deny', value: '' };
    if (t.startsWith('data:')) {
        const id = createInlineId(t);
        const parsed = parseDataUrl(t);
        if (!parsed)
            return { kind: 'deny', value: '' };
        return {
            kind: 'data',
            value: exports.VIRTUAL_DATA_PREFIX + id,
            id,
            body: parsed.body,
            contentType: parsed.contentType,
        };
    }
    if (t.startsWith('blob:')) {
        const id = createInlineId(t);
        return { kind: 'blob', value: exports.VIRTUAL_BLOB_PREFIX + id, id, sourceUrl: t };
    }
    const abs = absolutizeUrl(t, pageBase);
    if (!/^https?:\/\//i.test(abs))
        return { kind: 'unchanged', value: raw };
    const key = (0, DomAssetCache_1.virtualAssetKeyFromUrl)(abs);
    const virtual = httpUrlToVirtual(abs);
    if (!key || !virtual)
        return { kind: 'unchanged', value: raw };
    return {
        kind: 'http',
        value: virtual,
        sourceUrl: abs,
        key,
        passThrough: (0, DomAssetCache_1.isPassThroughUrl)(abs),
    };
}
/** Rewrite a single attr value (plain URL, srcset, or style cssText). */
function rewriteAttrValue(name, value, pageBase, onRewrite) {
    const lower = name.toLowerCase();
    if (lower === 'srcset' || lower === 'imagesrcset') {
        return (0, srcsetParse_1.mapSrcset)(value, (u) => {
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
function rewriteCssText(css, pageBase, onRewrite) {
    const abs = absolutizeCssUrls(css, pageBase);
    // Collect http(s) urls for materialize, then rewrite to virtual.
    abs.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_m, _q, raw) => {
        const r = classifyAndRewriteUrl(raw.trim(), pageBase);
        onRewrite(r);
        return _m;
    });
    abs.replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, _q, raw) => {
        const r = classifyAndRewriteUrl(raw.trim(), pageBase);
        onRewrite(r);
        return _m;
    });
    return rewriteCssUrlsToVirtual(abs);
}
//# sourceMappingURL=urlForms.js.map