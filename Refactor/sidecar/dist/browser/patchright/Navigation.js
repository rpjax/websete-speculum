"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Navigation = void 0;
exports.matchesAllowedDomain = matchesAllowedDomain;
exports.relaxMainFrameCspHeaders = relaxMainFrameCspHeaders;
exports.injectPermissiveMainFrameCsp = injectPermissiveMainFrameCsp;
exports.scriptMatchesUrl = scriptMatchesUrl;
exports.urlRuleMatches = urlRuleMatches;
exports.domainMatches = domainMatches;
exports.pathMatches = pathMatches;
const ChromeRuntime_1 = require("./ChromeRuntime");
const PERMISSIVE_MAIN_FRAME_CSP = [
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src-elem * data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src-attr * 'unsafe-inline'",
    "connect-src * data: blob: ws: wss:",
].join('; ');
function matchesAllowedDomain(host, patterns) {
    const normalizedHost = host.toLowerCase();
    for (const pattern of patterns) {
        if (!pattern)
            continue;
        const normalizedPattern = pattern.toLowerCase();
        if (normalizedPattern.startsWith('*.')) {
            const suffix = normalizedPattern.slice(2);
            if (normalizedHost.endsWith('.' + suffix))
                return true;
        }
        else if (normalizedHost === normalizedPattern) {
            return true;
        }
    }
    return false;
}
function relaxMainFrameCspHeaders(responseHeaders) {
    const kept = [];
    for (const header of responseHeaders ?? []) {
        const name = header.name?.trim();
        if (!name)
            continue;
        const lower = name.toLowerCase();
        if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
            continue;
        }
        kept.push({ name, value: header.value ?? '' });
    }
    kept.push({ name: 'Content-Security-Policy', value: PERMISSIVE_MAIN_FRAME_CSP });
    return kept;
}
function injectPermissiveMainFrameCsp(html) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${PERMISSIVE_MAIN_FRAME_CSP}">`;
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => m + meta);
    }
    if (/<html[^>]*>/i.test(html)) {
        return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${meta}</head>`);
    }
    return `<head>${meta}</head>${html}`;
}
/** Empty rules never match — match-all must be an explicit Any/Any rule. */
function scriptMatchesUrl(script, url) {
    if (!script.targetRules?.length) {
        return false;
    }
    return script.targetRules.some((rule) => urlRuleMatches(rule, url));
}
function urlRuleMatches(rule, url) {
    return domainMatches(rule.domain, url.hostname) && pathMatches(rule.path, url.pathname);
}
/**
 * Domain match aligned with UrlResolver:
 * - Scope Any → all hosts
 * - Leading label Any (*.apex) → host EndsWith(".apex") and host !== apex
 * - All Exact → exact host equality
 * - Mid-label Any → reject (not supported)
 */
function domainMatches(pattern, host) {
    const scope = normalizeScope(pattern.scope);
    if (scope === 'Any') {
        return true;
    }
    if (scope !== 'Pattern' || !pattern.labels?.length) {
        return false;
    }
    const labels = pattern.labels;
    const normalizedHost = host.toLowerCase();
    if (normalizeMatch(labels[0]?.match) === 'Any') {
        const apexParts = [];
        for (let i = 1; i < labels.length; i += 1) {
            const part = labels[i];
            if (normalizeMatch(part.match) !== 'Exact' || !(part.value ?? '').trim()) {
                return false;
            }
            apexParts.push(part.value.trim().toLowerCase());
        }
        if (apexParts.length === 0) {
            return false;
        }
        const apex = apexParts.join('.');
        return normalizedHost.endsWith(`.${apex}`) && normalizedHost !== apex;
    }
    if (labels.some((label) => normalizeMatch(label.match) !== 'Exact' || !(label.value ?? '').trim())) {
        return false;
    }
    const exact = labels.map((label) => label.value.trim().toLowerCase()).join('.');
    return normalizedHost === exact;
}
function pathMatches(pattern, pathname) {
    const scope = normalizeScope(pattern.scope);
    if (scope === 'Any') {
        return true;
    }
    if (scope !== 'Pattern') {
        return false;
    }
    const segments = pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => segment.toLowerCase());
    const expected = pattern.segments ?? [];
    const matchType = normalizeMatchType(pattern.matchType);
    if (matchType === 'Exact' && segments.length !== expected.length) {
        return false;
    }
    if (segments.length < expected.length) {
        return false;
    }
    for (let i = 0; i < expected.length; i += 1) {
        const part = expected[i];
        if (normalizeMatch(part.match) === 'Any') {
            continue;
        }
        if (normalizeMatch(part.match) !== 'Exact') {
            return false;
        }
        if ((part.value ?? '').trim().toLowerCase() !== segments[i]) {
            return false;
        }
    }
    return true;
}
function normalizeScope(value) {
    const v = (value ?? '').trim().toLowerCase();
    if (v === 'any')
        return 'Any';
    if (v === 'pattern')
        return 'Pattern';
    return value ?? '';
}
function normalizeMatch(value) {
    const v = (value ?? '').trim().toLowerCase();
    if (v === 'any')
        return 'Any';
    if (v === 'exact')
        return 'Exact';
    return value ?? '';
}
function normalizeMatchType(value) {
    const v = (value ?? '').trim().toLowerCase();
    if (v === 'exact')
        return 'Exact';
    if (v === 'prefix')
        return 'Prefix';
    return value ?? 'Prefix';
}
class Navigation {
    sessionId;
    events;
    mainFrameId;
    constructor(sessionId, events) {
        this.sessionId = sessionId;
        this.events = events;
    }
    async setupSingleTab(context) {
        await context.addInitScript(`
            (function () {
                'use strict';
                try {
                    Object.defineProperty(window, 'opener', {
                        value: null, writable: false, configurable: false,
                    });
                } catch (_) {}
                var _origOpen = window.open.bind(window);
                window.open = function speculum_open(url, target, features) {
                    var href = (url instanceof URL) ? url.href : String(url || '');
                    if (href && !href.startsWith('javascript:') && !href.startsWith('about:') && !href.startsWith('blob:')) {
                        window.location.href = href;
                        return null;
                    }
                    return _origOpen(url, target, features);
                };
                document.addEventListener('click', function (e) {
                    if (e.defaultPrevented) return;
                    var el = e.target;
                    var a = el instanceof Element ? el.closest('a') : null;
                    if (!a) return;
                    var t = (a.getAttribute('target') || '').toLowerCase();
                    if (t !== '_blank' && t !== '_new') return;
                    var href = a.href;
                    if (!href || href.startsWith('javascript:') || href.startsWith('about:') || href.startsWith('blob:')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = href;
                }, true);
                document.addEventListener('submit', function (e) {
                    var form = e.target instanceof HTMLFormElement ? e.target : null;
                    if (!form) return;
                    var t = (form.getAttribute('target') || '').toLowerCase();
                    if (t === '_blank' || t === '_new') form.setAttribute('target', '_self');
                }, true);
            })();
        `);
    }
    setupTabInterception(context, page) {
        context.on('page', (newPage) => {
            if (newPage === page)
                return;
            void (async () => {
                let targetUrl = null;
                try {
                    await newPage.waitForURL((u) => u.protocol !== 'about:' && u.protocol !== 'chrome:', { timeout: 2_000 });
                    targetUrl = newPage.url();
                }
                catch {
                    try {
                        targetUrl = newPage.url();
                    }
                    catch {
                        /* gone */
                    }
                }
                try {
                    await newPage.close();
                }
                catch {
                    /* */
                }
                if (targetUrl && /^https?:/i.test(targetUrl)) {
                    try {
                        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                    }
                    catch {
                        /* */
                    }
                }
            })();
        });
    }
    setupLocationSync(page) {
        page.on('framenavigated', (frame) => {
            try {
                if (frame !== page.mainFrame())
                    return;
                const url = page.url();
                if (!/^https?:\/\//i.test(url))
                    return;
                this.events.onLocationChanged(url);
            }
            catch {
                /* frame/page can detach mid-navigation */
            }
        });
    }
    async setupFetchGuard(cdp, scripts, allowedNavigationDomains) {
        const scriptMap = new Map(scripts.map((s) => [s.file, s]));
        const hasScripts = scripts.length > 0;
        const hasGuard = !!allowedNavigationDomains && allowedNavigationDomains.length > 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const patterns = [];
        for (const s of scripts) {
            patterns.push({ requestStage: 'Request', urlPattern: `*${s.file}*` });
        }
        if (hasGuard)
            patterns.push({ requestStage: 'Request', resourceType: 'Document' });
        // Always rewrite main-frame HTML CSP; inject only rule-matching scripts.
        patterns.push({ requestStage: 'Response', resourceType: 'Document' });
        if (patterns.length === 0)
            return;
        await cdp.send('Page.enable', {});
        await cdp.send('Fetch.enable', { patterns });
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { frameTree } = (await cdp.send('Page.getFrameTree', {}));
            this.mainFrameId = frameTree?.frame?.id;
        }
        catch {
            /* */
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Page.frameNavigated', (event) => {
            const frame = event?.frame;
            if (frame && !frame.parentId)
                this.mainFrameId = frame.id;
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Fetch.requestPaused', async (event) => {
            const { requestId, responseStatusCode, responseHeaders, request } = event;
            const url = request?.url ?? '';
            if (responseStatusCode !== undefined) {
                if (responseStatusCode >= 300 && responseStatusCode < 400) {
                    try {
                        await cdp.send('Fetch.continueResponse', { requestId });
                    }
                    catch {
                        /* */
                    }
                    return;
                }
                if (this.mainFrameId && event.frameId !== this.mainFrameId) {
                    try {
                        await cdp.send('Fetch.continueResponse', { requestId });
                    }
                    catch {
                        /* */
                    }
                    return;
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ct = (responseHeaders ?? []).find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
                if (!ct.includes('text/html')) {
                    try {
                        await cdp.send('Fetch.continueResponse', { requestId });
                    }
                    catch {
                        /* */
                    }
                    return;
                }
                try {
                    const { body, base64Encoded } = await cdp.send('Fetch.getResponseBody', { requestId });
                    const html = base64Encoded
                        ? Buffer.from(body, 'base64').toString('utf-8')
                        : body;
                    const documentUrl = new URL(url);
                    const matchedScripts = scripts.filter((script) => scriptMatchesUrl(script, documentUrl));
                    const withTags = matchedScripts.length > 0
                        ? (0, ChromeRuntime_1.injectScriptTags)(html, matchedScripts)
                        : html;
                    const patched = injectPermissiveMainFrameCsp(withTags);
                    const headers = relaxMainFrameCspHeaders(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (responseHeaders ?? []).filter((h) => !['content-encoding', 'content-length'].includes(h.name.toLowerCase())));
                    await cdp.send('Fetch.fulfillRequest', {
                        requestId,
                        responseCode: responseStatusCode,
                        responseHeaders: headers,
                        body: Buffer.from(patched, 'utf-8').toString('base64'),
                    });
                }
                catch {
                    try {
                        await cdp.send('Fetch.continueResponse', { requestId });
                    }
                    catch {
                        /* */
                    }
                }
                return;
            }
            if (hasScripts && url) {
                try {
                    const { pathname } = new URL(url);
                    const script = scriptMap.get(pathname);
                    if (script) {
                        await cdp.send('Fetch.fulfillRequest', {
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
                    /* */
                }
            }
            if (hasGuard && url && (url.startsWith('http://') || url.startsWith('https://'))) {
                const isMainFrame = !this.mainFrameId || event.frameId === this.mainFrameId;
                if (isMainFrame) {
                    try {
                        const host = new URL(url).hostname;
                        if (!matchesAllowedDomain(host, allowedNavigationDomains)) {
                            console.log(`[${this.sessionId}] Navigation blocked: '${host}' ∉ allowed domains`);
                            this.events.onMainFrameNavigationBlocked(url);
                            await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
                            return;
                        }
                    }
                    catch {
                        /* */
                    }
                }
            }
            try {
                await cdp.send('Fetch.continueRequest', { requestId });
            }
            catch {
                /* */
            }
        });
    }
}
exports.Navigation = Navigation;
//# sourceMappingURL=Navigation.js.map