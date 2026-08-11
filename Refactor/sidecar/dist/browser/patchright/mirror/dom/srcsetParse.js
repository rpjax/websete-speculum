"use strict";
/**
 * WHATWG-ish image-candidate parse for `srcset` / `imagesrcset`.
 * URL runs through commas until ASCII whitespace; candidates split only after
 * descriptors (or a trailing comma on a URL-only candidate).
 * @see https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSrcset = parseSrcset;
exports.mapSrcset = mapSrcset;
function isAsciiWhitespace(c) {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}
function parseSrcset(input) {
    const candidates = [];
    let pos = 0;
    const len = input.length;
    while (pos < len) {
        while (pos < len && (input[pos] === ',' || isAsciiWhitespace(input[pos])))
            pos += 1;
        if (pos >= len)
            break;
        const urlStart = pos;
        while (pos < len && !isAsciiWhitespace(input[pos]))
            pos += 1;
        let url = input.slice(urlStart, pos);
        if (url.endsWith(',')) {
            url = url.replace(/,+$/, '');
            if (url)
                candidates.push({ url, descriptor: '' });
            continue;
        }
        while (pos < len && isAsciiWhitespace(input[pos]))
            pos += 1;
        const descParts = [];
        let current = '';
        let state = 'in';
        while (pos < len) {
            const c = input[pos];
            if (state === 'in') {
                if (isAsciiWhitespace(c)) {
                    if (current) {
                        descParts.push(current);
                        current = '';
                        state = 'after';
                    }
                    pos += 1;
                }
                else if (c === ',') {
                    if (current)
                        descParts.push(current);
                    current = '';
                    pos += 1;
                    break;
                }
                else if (c === '(') {
                    current += c;
                    state = 'parens';
                    pos += 1;
                }
                else {
                    current += c;
                    pos += 1;
                }
            }
            else if (state === 'parens') {
                current += c;
                if (c === ')')
                    state = 'in';
                pos += 1;
            }
            else if (isAsciiWhitespace(c)) {
                pos += 1;
            }
            else {
                state = 'in';
            }
        }
        if (current)
            descParts.push(current);
        if (url)
            candidates.push({ url, descriptor: descParts.join(' ') });
    }
    return candidates;
}
/** Map each candidate URL; preserve descriptors and `, ` separators. */
function mapSrcset(input, mapUrl) {
    return parseSrcset(input)
        .map((c) => {
        const u = mapUrl(c.url);
        return c.descriptor ? `${u} ${c.descriptor}` : u;
    })
        .join(', ');
}
//# sourceMappingURL=srcsetParse.js.map