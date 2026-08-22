"use strict";
/**
 * Single CDP Fetch hook: Document **Response** stage only (main frame + iframes).
 *
 * Chromium already completed TLS/HTTP for the request — we only mutate the arrived
 * response. Never pause Document at Request / never fulfill Document from Node bytes
 * that were not obtained via Fetch.getResponseBody.
 *
 * Mutators run in order (CSP first; script-tag inject later). If nothing changes,
 * continueResponse — do not re-fulfill.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cspDocumentMutator = cspDocumentMutator;
exports.installDocumentResponseHook = installDocumentResponseHook;
const relaxCsp_1 = require("./relaxCsp");
/** CSP surgical mutator — enforcing headers + meta; Report-Only left alone. */
function cspDocumentMutator(ctx) {
    const { headers, cspChanged } = (0, relaxCsp_1.rewriteCspResponseHeaders)(ctx.headers);
    const meta = (0, relaxCsp_1.rewriteCspMetasInHtml)(ctx.bodyHtml);
    return {
        headers,
        bodyHtml: meta.html,
        changed: cspChanged || meta.changed,
    };
}
/**
 * Enable Fetch on Document Response and attach the mutator pipeline.
 * Idempotent per CDP session only if called once — caller owns lifecycle with the page.
 */
async function installDocumentResponseHook(cdp, opts) {
    const mutators = opts?.mutators ?? [cspDocumentMutator];
    await cdp.send('Fetch.enable', {
        patterns: [{ requestStage: 'Response', resourceType: 'Document' }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdp.on('Fetch.requestPaused', async (event) => {
        const requestId = event?.requestId;
        if (!requestId)
            return;
        const responseStatusCode = event?.responseStatusCode;
        // Request-stage events must never be fulfilled here — Document pattern is Response-only,
        // but continue defensively if CDP delivers an unexpected pause.
        if (responseStatusCode === undefined) {
            try {
                await cdp.send('Fetch.continueRequest', { requestId });
            }
            catch {
                /* session tearing down */
            }
            return;
        }
        const continueResponse = async () => {
            try {
                await cdp.send('Fetch.continueResponse', { requestId });
            }
            catch {
                /* */
            }
        };
        if (responseStatusCode >= 300 && responseStatusCode < 400) {
            await continueResponse();
            return;
        }
        const rawHeaders = (event?.responseHeaders ?? []);
        const headers = rawHeaders
            .filter((h) => !!h.name?.trim())
            .map((h) => ({ name: h.name.trim(), value: h.value ?? '' }));
        const ct = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
        if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
            await continueResponse();
            return;
        }
        try {
            const { body, base64Encoded } = (await cdp.send('Fetch.getResponseBody', {
                requestId,
            }));
            const bodyHtml = base64Encoded
                ? Buffer.from(body, 'base64').toString('utf-8')
                : body;
            let ctx = {
                url: event?.request?.url ?? '',
                statusCode: responseStatusCode,
                headers,
                bodyHtml,
            };
            let changed = false;
            for (const mutator of mutators) {
                const result = mutator(ctx);
                ctx = {
                    ...ctx,
                    headers: result.headers,
                    bodyHtml: result.bodyHtml,
                };
                if (result.changed)
                    changed = true;
            }
            if (!changed) {
                await continueResponse();
                return;
            }
            await cdp.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: responseStatusCode,
                responseHeaders: ctx.headers,
                body: Buffer.from(ctx.bodyHtml, 'utf-8').toString('base64'),
            });
        }
        catch {
            await continueResponse();
        }
    });
}
//# sourceMappingURL=documentResponseHook.js.map