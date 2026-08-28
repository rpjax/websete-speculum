"use strict";
/**
 * CDP Fetch hook: Document **Response** stage (CSP surgery only).
 *
 * Chromium already completed TLS/HTTP for the request — we only mutate the arrived
 * response. Never pause Document at Request / never fulfill Document from Node bytes
 * that were not obtained via Fetch.getResponseBody.
 *
 * Scope (csp.md §3): every browsing context that loads HTML — main **and** iframes,
 * including cross-site OOPIF. Page CDP alone can miss OOPIF Document requests.
 * Child targets get the same Fetch patterns via `context.newCDPSession(frame)`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cspDocumentMutator = cspDocumentMutator;
exports.handleDocumentResponsePausedForTest = handleDocumentResponsePausedForTest;
exports.installDocumentResponseHook = installDocumentResponseHook;
const relaxCsp_1 = require("./relaxCsp");
const cspDiag_1 = require("./cspDiag");
const frameCdpSession_1 = require("../frameCdpSession");
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
const byPageCdp = new WeakMap();
const DOCUMENT_RESPONSE_PATTERNS = [{ requestStage: 'Response', resourceType: 'Document' }];
/** @internal Exported for unit tests — Document Response paused handler. */
async function handleDocumentResponsePausedForTest(send, event, mutators) {
    return handleRequestPaused(send, event, mutators);
}
async function handleRequestPaused(send, event, mutators) {
    const requestId = event?.requestId;
    if (!requestId)
        return;
    const responseStatusCode = event?.responseStatusCode;
    if (responseStatusCode === undefined) {
        try {
            await send('Fetch.continueRequest', { requestId });
        }
        catch {
            /* session tearing down */
        }
        return;
    }
    const continueResponse = async () => {
        try {
            await send('Fetch.continueResponse', { requestId });
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
    /** Header-only continue — used when body get/fulfill fails (huge Document, CDP limits). */
    const continueWithHeaders = async (nextHeaders) => {
        await send('Fetch.continueResponse', {
            requestId,
            responseCode: responseStatusCode,
            responseHeaders: nextHeaders,
        });
    };
    const headerOnly = (0, relaxCsp_1.rewriteCspResponseHeaders)(headers);
    const docUrl = event?.request?.url ?? '';
    (0, cspDiag_1.cspDiagLog)('document paused', {
        url: docUrl.slice(0, 120),
        status: responseStatusCode,
        headerCsp: headerOnly.cspChanged,
    });
    try {
        const { body, base64Encoded } = (await send('Fetch.getResponseBody', {
            requestId,
        }));
        const bodyHtml = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
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
            (0, cspDiag_1.cspDiagLog)('document unchanged continue', { url: docUrl.slice(0, 120) });
            await continueResponse();
            return;
        }
        try {
            await send('Fetch.fulfillRequest', {
                requestId,
                responseCode: responseStatusCode,
                responseHeaders: ctx.headers,
                body: Buffer.from(ctx.bodyHtml, 'utf-8').toString('base64'),
            });
            (0, cspDiag_1.cspDiagLog)('document fulfill ok', { url: docUrl.slice(0, 120), changed });
        }
        catch (fulfillErr) {
            (0, cspDiag_1.cspDiagLog)('document fulfill failed', {
                url: docUrl.slice(0, 120),
                err: fulfillErr instanceof Error ? fulfillErr.message : String(fulfillErr),
                headerFallback: headerOnly.cspChanged,
            });
            if (headerOnly.cspChanged) {
                await continueWithHeaders(headerOnly.headers);
            }
            else {
                await continueResponse();
            }
        }
    }
    catch (bodyErr) {
        (0, cspDiag_1.cspDiagLog)('getResponseBody failed', {
            url: docUrl.slice(0, 120),
            err: bodyErr instanceof Error ? bodyErr.message : String(bodyErr),
            headerFallback: headerOnly.cspChanged,
        });
        if (headerOnly.cspChanged) {
            await continueWithHeaders(headerOnly.headers);
        }
        else {
            await continueResponse();
        }
    }
}
async function enableFetchOnSession(session, state) {
    await session.send('Fetch.enable', { patterns: state.patterns });
    if (state.pausedBound.has(session))
        return;
    state.pausedBound.add(session);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.on('Fetch.requestPaused', async (event) => {
        const send = (method, params) => 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session.send(method, params);
        await handleRequestPaused(send, event, state.mutators);
    });
}
async function attachFrameFetch(frame, page, context, state) {
    const frameCdp = await (0, frameCdpSession_1.attachFrameCdp)(frame, page, context, state.frameState);
    if (frameCdp)
        await enableFetchOnSession(frameCdp, state);
}
/**
 * Enable Fetch on Document Response and attach CSP mutators.
 * Also attaches the same Fetch hook to OOPIF frames when `page` + `context` are provided.
 */
async function installDocumentResponseHook(cdp, opts) {
    const mutators = opts?.mutators ?? [cspDocumentMutator];
    const context = opts?.context ?? null;
    const page = opts?.page ?? null;
    let state = byPageCdp.get(cdp);
    if (!state) {
        state = {
            patterns: DOCUMENT_RESPONSE_PATTERNS,
            mutators,
            frameState: (0, frameCdpSession_1.createFrameCdpAttachState)(),
            pausedBound: new WeakSet(),
        };
        byPageCdp.set(cdp, state);
    }
    else {
        state.mutators = mutators;
    }
    await enableFetchOnSession(cdp, state);
    if (page && context) {
        await (0, frameCdpSession_1.wireFrameCdpLifecycle)({
            page,
            context,
            state: state.frameState,
            onFrameSession: (frame) => attachFrameFetch(frame, page, context, state),
            onMainFrameNavigated: () => enableFetchOnSession(cdp, state),
        });
    }
}
//# sourceMappingURL=documentResponseHook.js.map