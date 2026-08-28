"use strict";
/**
 * CDP Fetch hook: Document **Response** stage (+ stored-script Request fulfill).
 *
 * Chromium already completed TLS/HTTP for the request — we only mutate the arrived
 * response. Never pause Document at Request / never fulfill Document from Node bytes
 * that were not obtained via Fetch.getResponseBody.
 *
 * Mutators run in order (CSP first; script-tag inject later). If nothing changes,
 * continueResponse — do not re-fulfill.
 *
 * Scope (csp.md §3): every browsing context that loads HTML — main **and** iframes,
 * including cross-site OOPIF. Page CDP alone can miss OOPIF Script requests (Eneba /
 * Cloudflare Turnstile). Child targets get the same Fetch patterns via
 * `context.newCDPSession(frame)` (Patchright public API). Browser-level
 * `Target.setAutoAttach` with `flatten:false` is rejected by Chromium; do not use it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cspDocumentMutator = cspDocumentMutator;
exports.handleDocumentResponsePausedForTest = handleDocumentResponsePausedForTest;
exports.installDocumentResponseHook = installDocumentResponseHook;
const relaxCsp_1 = require("./relaxCsp");
const cspDiag_1 = require("./cspDiag");
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
function buildFetchPatterns(storedScripts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patterns = [{ requestStage: 'Response', resourceType: 'Document' }];
    for (const s of storedScripts) {
        patterns.push({ requestStage: 'Request', urlPattern: `*${s.file}*` });
    }
    return patterns;
}
/** @internal Exported for unit tests — Document Response paused handler. */
async function handleDocumentResponsePausedForTest(send, event, scriptMap, mutators) {
    return handleRequestPaused(send, event, scriptMap, mutators);
}
async function handleRequestPaused(send, event, scriptMap, mutators) {
    const requestId = event?.requestId;
    if (!requestId)
        return;
    const responseStatusCode = event?.responseStatusCode;
    if (responseStatusCode === undefined) {
        const url = event?.request?.url ?? '';
        if (scriptMap.size > 0 && url) {
            try {
                const { pathname } = new URL(url);
                const script = scriptMap.get(pathname);
                if (script) {
                    await send('Fetch.fulfillRequest', {
                        requestId,
                        responseCode: 200,
                        responseHeaders: [
                            { name: 'content-type', value: 'text/javascript; charset=utf-8' },
                            { name: 'cache-control', value: 'no-store' },
                        ],
                        body: Buffer.from(script.content, 'utf-8').toString('base64'),
                    });
                    return;
                }
            }
            catch {
                /* fall through */
            }
        }
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
            // Body rewrite failed — still apply enforcing CSP header surgery (csp.md §4/§5).
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
        // getResponseBody failed — header surgery still applies when CSP was present.
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
        await handleRequestPaused(send, event, state.scriptMap, state.mutators);
    });
}
async function attachFrameSession(frame, page, context, state) {
    if (frame === page.mainFrame())
        return;
    if (state.frameSessions.has(frame))
        return;
    try {
        const frameCdp = await context.newCDPSession(frame);
        state.frameSessions.set(frame, frameCdp);
        await enableFetchOnSession(frameCdp, state);
    }
    catch {
        /* same-process iframe / detached — page session may already see its network */
    }
}
/**
 * Enable Fetch on Document Response (+ optional stored-script Requests) and attach mutators.
 * Also attaches the same Fetch hook to OOPIF frames when `page` + `context` are provided.
 *
 * Idempotent per page CDPSession for the root session — caller owns lifecycle with the page.
 */
async function installDocumentResponseHook(cdp, opts) {
    const mutators = opts?.mutators ?? [cspDocumentMutator];
    const storedScripts = opts?.storedScripts ?? [];
    const scriptMap = new Map(storedScripts.map((s) => [s.file, s]));
    const patterns = buildFetchPatterns(storedScripts);
    const context = opts?.context ?? null;
    const page = opts?.page ?? null;
    let state = byPageCdp.get(cdp);
    if (!state) {
        state = {
            patterns,
            scriptMap,
            mutators,
            frameSessions: new WeakMap(),
            pausedBound: new WeakSet(),
        };
        byPageCdp.set(cdp, state);
    }
    else {
        state.patterns = patterns;
        state.scriptMap = scriptMap;
        state.mutators = mutators;
    }
    await enableFetchOnSession(cdp, state);
    if (page && context) {
        for (const frame of page.frames()) {
            await attachFrameSession(frame, page, context, state);
        }
        page.on('frameattached', (frame) => {
            void attachFrameSession(frame, page, context, state);
        });
        // OOPIF can swap network target on navigation — re-bind Fetch.
        // Main frame: re-Fetch.enable after cross-process nav (session may keep object, patterns drop).
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) {
                void enableFetchOnSession(cdp, state);
                return;
            }
            if (state.frameSessions.has(frame))
                return;
            void attachFrameSession(frame, page, context, state);
        });
    }
}
//# sourceMappingURL=documentResponseHook.js.map