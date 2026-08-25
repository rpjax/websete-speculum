"use strict";
/**
 * Lab HTTP serve for `/w7s/virtual-*` — same contract as DomAssetEndpoints (virtual-assets.md).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripReservedFromQuery = stripReservedFromQuery;
exports.tryServeLabVirtualAsset = tryServeLabVirtualAsset;
exports.absolutizeRelativeCssUrlsToVirtual = absolutizeRelativeCssUrlsToVirtual;
const sessionBindingAuth_1 = require("@speculum/page-projection/projected/sessionBindingAuth");
const SESSION_AUTH_PARAM = 'speculum-session-token';
const CACHE_BUST_PARAM = 'speculum-cache-bust';
function stripReservedFromQuery(query) {
    if (!query)
        return '';
    const raw = query.startsWith('?') ? query.slice(1) : query;
    const kept = raw
        .split('&')
        .filter((part) => part.length > 0)
        .filter((part) => {
        const eq = part.indexOf('=');
        const key = (eq >= 0 ? part.slice(0, eq) : part).toLowerCase();
        return key !== SESSION_AUTH_PARAM && key !== CACHE_BUST_PARAM;
    });
    return kept.length > 0 ? `?${kept.join('&')}` : '';
}
function tokenFromRequest(url, req) {
    const q = url.searchParams.get(SESSION_AUTH_PARAM) ?? '';
    if (q)
        return q;
    const header = req.headers['x-speculum-session-token'];
    if (typeof header === 'string' && header)
        return header;
    if (Array.isArray(header) && header[0])
        return header[0];
    return '';
}
function findSessionByToken(sessions, token) {
    for (const s of sessions.values()) {
        if (s.sessionToken === token)
            return s;
    }
    return null;
}
async function tryServeLabVirtualAsset(req, res, pathname, rawUrl, sessions) {
    let kind = null;
    let key = '';
    if (pathname.startsWith('/w7s/virtual-assets/')) {
        kind = 'asset';
        const rest = pathname.slice('/w7s/virtual-assets/'.length);
        const u = new URL(rawUrl, 'http://lab.local');
        const query = stripReservedFromQuery(u.search);
        key = `${rest}${query}`;
    }
    else if (pathname.startsWith('/w7s/virtual-blob/')) {
        kind = 'blob';
        key = pathname.slice('/w7s/virtual-blob/'.length);
    }
    else if (pathname.startsWith('/w7s/virtual-data/')) {
        kind = 'data';
        key = pathname.slice('/w7s/virtual-data/'.length);
    }
    else {
        return false;
    }
    const u = new URL(rawUrl, 'http://lab.local');
    const token = tokenFromRequest(u, req);
    if (!token) {
        res.writeHead(401).end('unauthorized');
        return true;
    }
    const session = findSessionByToken(sessions, token);
    if (!session) {
        res.writeHead(401).end('unauthorized');
        return true;
    }
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const asset = await session.getAsset(key, { kind, rangeHeader: range });
    if (!asset || (asset.body.byteLength === 0 && (asset.statusCode === 0 || asset.statusCode === 404))) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errorCode: 'asset_missing' }));
        return true;
    }
    const status = asset.statusCode && asset.statusCode >= 200 && asset.statusCode < 300 ? asset.statusCode : 200;
    const contentType = asset.contentType || 'application/octet-stream';
    let bodyBuf = Buffer.from(asset.body);
    if (/text\/css|mpegurl|dash\+xml|x-mpegurl|apple\.mpegurl/i.test(contentType)) {
        let text = bodyBuf.toString('utf8');
        if (/text\/css/i.test(contentType)) {
            text = absolutizeRelativeCssUrlsToVirtual(text, key);
        }
        text = (0, sessionBindingAuth_1.stampAuthInServedBody)(text, contentType, token);
        bodyBuf = Buffer.from(text, 'utf8');
    }
    const headers = {
        'Content-Type': contentType,
        'Content-Length': bodyBuf.byteLength,
    };
    if (asset.contentRange)
        headers['Content-Range'] = asset.contentRange;
    res.writeHead(status, headers);
    res.end(bodyBuf);
    return true;
}
/**
 * Relative / root-relative URLs inside a virtual CSS file resolve against the CSS path
 * *without* inheriting `speculum-session-token`. Lift them to `/w7s/virtual-assets/{host}…`
 * before stamping auth. Fill-time rewrite usually already did this; serve-time is the safety net.
 */
function absolutizeRelativeCssUrlsToVirtual(css, assetKey) {
    const pathOnly = assetKey.split('?')[0] ?? assetKey;
    const slash = pathOnly.indexOf('/');
    const host = slash >= 0 ? pathOnly.slice(0, slash) : pathOnly;
    const dirSlash = pathOnly.lastIndexOf('/');
    const dir = dirSlash >= 0 ? pathOnly.slice(0, dirSlash + 1) : `${host}/`;
    const lift = (trimmed) => {
        if (!trimmed ||
            trimmed.startsWith('data:') ||
            trimmed.startsWith('http://') ||
            trimmed.startsWith('https://') ||
            trimmed.startsWith('/w7s/') ||
            trimmed.startsWith('blob:')) {
            return null;
        }
        try {
            const abs = new URL(trimmed, `https://${dir}`);
            return `/w7s/virtual-assets/${abs.host}${abs.pathname}${abs.search}`;
        }
        catch {
            return null;
        }
    };
    let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
        const lifted = lift(raw.trim());
        return lifted ? `url(${quote}${lifted}${quote})` : match;
    });
    out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, raw) => {
        const lifted = lift(raw.trim());
        return lifted ? `@import ${quote}${lifted}${quote}` : match;
    });
    return out;
}
//# sourceMappingURL=labVirtualAssets.js.map