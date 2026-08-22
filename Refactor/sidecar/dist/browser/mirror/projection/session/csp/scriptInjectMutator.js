"use strict";
/**
 * Launch script-tag inject for Document Response mutate (PP / shared Chromium path).
 * Pairs with {@link installDocumentResponseHook}; does not open a second Fetch.enable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScriptInjectMutator = createScriptInjectMutator;
const ChromeRuntime_1 = require("../../../../patchright/ChromeRuntime");
const Navigation_1 = require("../../../../patchright/Navigation");
/**
 * Inject matching stored/remote script tags into main-document HTML.
 * Empty scripts → no-op mutator (changed=false).
 */
function createScriptInjectMutator(scripts) {
    if (scripts.length === 0) {
        return (ctx) => ({ headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false });
    }
    return (ctx) => {
        let documentUrl;
        try {
            documentUrl = new URL(ctx.url);
        }
        catch {
            return { headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false };
        }
        const matched = scripts.filter((s) => (0, Navigation_1.scriptMatchesUrl)(s, documentUrl));
        if (matched.length === 0) {
            return { headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false };
        }
        const patched = (0, ChromeRuntime_1.injectScriptTags)(ctx.bodyHtml, matched);
        if (patched === ctx.bodyHtml) {
            return { headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false };
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
//# sourceMappingURL=scriptInjectMutator.js.map