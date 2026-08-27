"use strict";
/**
 * Surgical CSP relax for V4 cutover — preserve the origin policy.
 * Normative: docs/page-projection/spec/csp.md §§5–7.
 *
 * - `connect-src`: our runtime (always).
 * - Script: strip nonce/hash/`strict-dynamic`; always `'unsafe-inline'`;
 *   delta compensation `* blob: data:` only when strip fired (script-src / script-src-elem).
 * Not the legacy PERMISSIVE_* replace / setBypassCSP.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeCspMetaContent = decodeCspMetaContent;
exports.splitCspPolicies = splitCspPolicies;
exports.parseCspPolicy = parseCspPolicy;
exports.serializeCspPolicy = serializeCspPolicy;
exports.isNonceHashOrStrictDynamicToken = isNonceHashOrStrictDynamicToken;
exports.relaxCspPolicy = relaxCspPolicy;
exports.rewriteCspResponseHeaders = rewriteCspResponseHeaders;
exports.rewriteCspMetasInHtml = rewriteCspMetasInHtml;
const CONNECT_EXTRA = ['*', 'data:', 'blob:', 'ws:', 'wss:'];
const INLINE = "'unsafe-inline'";
const SCRIPT_NETWORK_COMPENSATION = ['*', 'blob:', 'data:'];
const NONE = "'none'";
/**
 * Decode common HTML entities that appear inside CSP meta `content` before parse.
 * Critical: `&#39;` contains a literal `;` — splitting the policy on `;` without decoding
 * shreds `'none'` / `'nonce-…'` into bogus directive names (Eneba Cloudflare challenge).
 */
function decodeCspMetaContent(raw) {
    return raw
        .replace(/&amp;/gi, '&')
        .replace(/&#0*39;/gi, "'")
        .replace(/&#x0*27;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&#0*34;/gi, '"')
        .replace(/&#x0*22;/gi, '"')
        .replace(/&quot;/gi, '"');
}
/**
 * Split a header value that may contain multiple CSP policies (comma-separated, CSP3).
 * Commas inside quoted tokens are preserved.
 */
function splitCspPolicies(headerValue) {
    const policies = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < headerValue.length; i++) {
        const ch = headerValue[i];
        if (ch === "'" || ch === '"') {
            inQuote = !inQuote;
            cur += ch;
            continue;
        }
        if (ch === ',' && !inQuote) {
            const t = cur.trim();
            if (t)
                policies.push(t);
            cur = '';
            continue;
        }
        cur += ch;
    }
    const t = cur.trim();
    if (t)
        policies.push(t);
    return policies.length > 0 ? policies : [headerValue.trim()].filter(Boolean);
}
/** Parse a single CSP policy string into directives (order preserved). */
function parseCspPolicy(policy) {
    const out = [];
    for (const raw of policy.split(';')) {
        const trimmed = raw.trim();
        if (!trimmed)
            continue;
        const parts = trimmed.split(/\s+/);
        const name = parts[0].toLowerCase();
        out.push({ name, values: parts.slice(1) });
    }
    return out;
}
function serializeCspPolicy(directives) {
    return directives
        .map((d) => (d.values.length ? `${d.name} ${d.values.join(' ')}` : d.name))
        .join('; ');
}
function hasToken(values, token) {
    const want = token.toLowerCase();
    return values.some((v) => v.toLowerCase() === want);
}
/**
 * Merge source list. `'none'` is exclusive (CSP) — drop it once any other source is present
 * so we never emit invalid `script-src-attr 'none' 'unsafe-inline'` style lists.
 */
function mergeUnique(values, extras) {
    const out = [...values];
    for (const e of extras) {
        if (!hasToken(out, e))
            out.push(e);
    }
    if (out.length > 1 && hasToken(out, NONE)) {
        return out.filter((v) => v.toLowerCase() !== NONE);
    }
    return out;
}
function findDirective(dirs, name) {
    return dirs.find((d) => d.name === name);
}
/** Nonce / hash / strict-dynamic tokens that must leave script directives (csp.md §6.2). */
function isNonceHashOrStrictDynamicToken(token) {
    const t = token.toLowerCase();
    if (t === "'strict-dynamic'")
        return true;
    if (t.startsWith("'nonce-") && t.endsWith("'"))
        return true;
    if ((t.startsWith("'sha256-") || t.startsWith("'sha384-") || t.startsWith("'sha512-")) &&
        t.endsWith("'")) {
        return true;
    }
    return false;
}
function stripNonceHashStrictDynamic(values) {
    const next = values.filter((v) => !isNonceHashOrStrictDynamicToken(v));
    return { values: next, stripped: next.length !== values.length };
}
/**
 * Relax one CSP policy string.
 *
 * - `connect-src`: ensure `* data: blob: ws: wss:` (create from `default-src` if missing).
 * - Script directives: strip nonce/hash/`strict-dynamic`; always merge `'unsafe-inline'`.
 * - If strip fired: merge `* blob: data:` into `script-src` / `script-src-elem` only
 *   (`script-src-attr` gets strip + inline only).
 * - Leaves all other directives untouched; preserves `'unsafe-eval'` etc. via merge.
 * - Does not touch Report-Only handling (caller chooses which header to pass).
 */
function relaxOnePolicy(trimmed) {
    const dirs = parseCspPolicy(trimmed);
    const defaultSrc = findDirective(dirs, 'default-src');
    const connect = findDirective(dirs, 'connect-src');
    if (connect) {
        connect.values = mergeUnique(connect.values, CONNECT_EXTRA);
    }
    else {
        dirs.push({
            name: 'connect-src',
            values: mergeUnique([...(defaultSrc?.values ?? [])], CONNECT_EXTRA),
        });
    }
    const scriptNames = ['script-src', 'script-src-elem', 'script-src-attr'];
    let anyStrip = false;
    const anyScript = scriptNames.some((n) => findDirective(dirs, n));
    if (anyScript) {
        for (const n of scriptNames) {
            const d = findDirective(dirs, n);
            if (!d)
                continue;
            const stripped = stripNonceHashStrictDynamic(d.values);
            d.values = stripped.values;
            if (stripped.stripped)
                anyStrip = true;
            d.values = mergeUnique(d.values, [INLINE]);
        }
    }
    else {
        dirs.push({
            name: 'script-src',
            values: mergeUnique([...(defaultSrc?.values ?? [])], [INLINE]),
        });
    }
    if (anyStrip) {
        const hasSrc = !!findDirective(dirs, 'script-src');
        const hasElem = !!findDirective(dirs, 'script-src-elem');
        if (!hasSrc && !hasElem) {
            dirs.push({
                name: 'script-src',
                values: mergeUnique([INLINE], SCRIPT_NETWORK_COMPENSATION),
            });
        }
        else {
            for (const n of ['script-src', 'script-src-elem']) {
                const d = findDirective(dirs, n);
                if (!d)
                    continue;
                d.values = mergeUnique(d.values, SCRIPT_NETWORK_COMPENSATION);
            }
        }
    }
    return serializeCspPolicy(dirs);
}
function relaxCspPolicy(policy) {
    const trimmed = policy.trim();
    if (!trimmed)
        return policy;
    // Multi-policy headers (comma-separated) — relax each independently, preserve AND semantics.
    const parts = splitCspPolicies(trimmed);
    if (parts.length <= 1)
        return relaxOnePolicy(trimmed);
    return parts.map((p) => relaxOnePolicy(p)).join(', ');
}
/**
 * Rewrite enforcing `Content-Security-Policy` headers; drop hop-by-hop length/encoding
 * when the body may be rewritten. Leaves `Content-Security-Policy-Report-Only` intact.
 */
function rewriteCspResponseHeaders(headers) {
    let cspChanged = false;
    const out = [];
    for (const h of headers) {
        const lower = h.name.trim().toLowerCase();
        if (lower === 'content-encoding' || lower === 'content-length')
            continue;
        if (lower === 'content-security-policy') {
            const next = relaxCspPolicy(h.value);
            if (next !== h.value)
                cspChanged = true;
            out.push({ name: h.name.trim(), value: next });
            continue;
        }
        out.push({ name: h.name.trim(), value: h.value });
    }
    return { headers: out, cspChanged };
}
/** Rewrite `<meta http-equiv=Content-Security-Policy content=…>` with the same relax. */
function rewriteCspMetasInHtml(html) {
    let changed = false;
    const next = html.replace(/<meta\b[^>]*>/gi, (tag) => {
        if (!/\bhttp-equiv\s*=\s*(["']?)Content-Security-Policy\1/i.test(tag))
            return tag;
        return tag.replace(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i, (full, dq, sq, bare) => {
            const encoded = dq ?? sq ?? bare ?? '';
            // Decode before parse — &#39; embeds `;` and must not be treated as a directive separator.
            const raw = decodeCspMetaContent(encoded);
            const relaxed = relaxCspPolicy(raw);
            if (relaxed === raw && encoded === raw)
                return full;
            changed = true;
            // Always re-emit double-quoted content so CSP `'…'` tokens stay intact.
            return `content="${relaxed.replace(/"/g, '&quot;')}"`;
        });
    });
    return { html: next, changed };
}
//# sourceMappingURL=relaxCsp.js.map