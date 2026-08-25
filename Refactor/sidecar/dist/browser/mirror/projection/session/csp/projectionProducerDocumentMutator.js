"use strict";
/**
 * Inject Virtual config + bundle into every Document response (main + same-origin iframes).
 * Pairs with installDocumentResponseHook — virtual.js is loaded by URL (stored script fulfill).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECTION_VIRTUAL_SCRIPT_PATH = void 0;
exports.createProjectionProducerDocumentMutator = createProjectionProducerDocumentMutator;
exports.PROJECTION_VIRTUAL_SCRIPT_PATH = '/__speculum/virtual.js';
function escapeInlineScript(source) {
    return source.replace(/<\/script/gi, '<\\/script');
}
function prependHeadScripts(html, headInner) {
    if (!headInner)
        return html;
    const headMatch = /<head(\s[^>]*)?>/i.exec(html);
    if (headMatch && headMatch.index !== undefined) {
        const insertAt = headMatch.index + headMatch[0].length;
        return html.slice(0, insertAt) + headInner + html.slice(insertAt);
    }
    const htmlMatch = /<html(\s[^>]*)?>/i.exec(html);
    if (htmlMatch && htmlMatch.index !== undefined) {
        const insertAt = htmlMatch.index + htmlMatch[0].length;
        return `${html.slice(0, insertAt)}<head>${headInner}</head>${html.slice(insertAt)}`;
    }
    return headInner + html;
}
function createProjectionProducerDocumentMutator(opts) {
    const virtualPath = opts.virtualScriptPath ?? exports.PROJECTION_VIRTUAL_SCRIPT_PATH;
    const headInner = `<script>${escapeInlineScript(opts.configPreScript)}</script>` +
        `<script src="${virtualPath}"></script>`;
    return (ctx) => {
        if (ctx.statusCode < 200 || ctx.statusCode >= 300) {
            return { headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false };
        }
        const body = ctx.bodyHtml;
        if (!/<html[\s>]/i.test(body) && !/<!doctype html/i.test(body)) {
            return { headers: ctx.headers, bodyHtml: body, changed: false };
        }
        const patched = prependHeadScripts(body, headInner);
        if (patched === body) {
            return { headers: ctx.headers, bodyHtml: body, changed: false };
        }
        const headers = ctx.headers
            .filter((h) => {
            const n = h.name.toLowerCase();
            return n !== 'content-encoding' && n !== 'content-length';
        })
            .map((h) => ({ name: h.name, value: h.value }));
        return { headers, bodyHtml: patched, changed: true };
    };
}
//# sourceMappingURL=projectionProducerDocumentMutator.js.map