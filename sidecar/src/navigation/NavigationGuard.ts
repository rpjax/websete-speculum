import { WebSocket } from 'ws';
import { BrowserContext, Page, CDPSession } from 'patchright';
import { AsyncChain } from '../AsyncChain';
import { encodeRedirectFrame, ScriptEntry } from '../protocol/wire-protocol';

/**
 * Fetch/tab interception, allowed-domain matching, and redirect signalling.
 */
export class NavigationGuard {
    /**
     * Installs single-tab enforcement on the browser context (Layer 1).
     */
    static async setupSingleTabEnforcement(context: BrowserContext): Promise<void> {
        await context.addInitScript(`
            (function () {
                'use strict';

                try {
                    Object.defineProperty(window, 'opener', {
                        value: null, writable: false, configurable: false,
                    });
                } catch (_) { /* already non-configurable */ }

                var _origOpen = window.open.bind(window);
                window.open = function speculum_open(url, target, features) {
                    var href = (url instanceof URL) ? url.href : String(url || '');
                    if (href &&
                        !href.startsWith('javascript:') &&
                        !href.startsWith('about:') &&
                        !href.startsWith('blob:')) {
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
                    if (!href ||
                        href.startsWith('javascript:') ||
                        href.startsWith('about:') ||
                        href.startsWith('blob:')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = href;
                }, true);

                document.addEventListener('submit', function (e) {
                    var form = e.target instanceof HTMLFormElement ? e.target : null;
                    if (!form) return;
                    var t = (form.getAttribute('target') || '').toLowerCase();
                    if (t === '_blank' || t === '_new') {
                        form.setAttribute('target', '_self');
                    }
                }, true);
            })();
        `);
    }

    /**
     * Unified CDP Fetch interception — local script serving, navigation guard, HTML injection.
     */
    static async setupFetchInterception(
        cdp:            CDPSession,
        ws:             WebSocket,
        sessionId:      string,
        scripts:        ScriptEntry[],
        allowedNavigationDomains: string[] | undefined,
    ): Promise<void> {
        const scriptMap  = new Map(scripts.map(s => [s.file, s] as const));
        const hasScripts = scripts.length > 0;
        const hasGuard   = !!allowedNavigationDomains && allowedNavigationDomains.length > 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const patterns: any[] = [];

        for (const s of scripts) {
            patterns.push({ requestStage: 'Request', urlPattern: `*${s.file}*` });
        }

        if (hasGuard) {
            patterns.push({ requestStage: 'Request', resourceType: 'Document' });
        }

        if (hasScripts) {
            patterns.push({ requestStage: 'Response', resourceType: 'Document' });
        }

        await cdp.send('Fetch.enable', { patterns });

        let mainFrameId: string | undefined;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { frameTree } = await cdp.send('Page.getFrameTree', {}) as any;
            mainFrameId = frameTree?.frame?.id as string | undefined;
        } catch { /* best-effort */ }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Page.frameNavigated', (event: any) => {
            const frame = event?.frame;
            if (frame && !frame.parentId)
                mainFrameId = frame.id as string;
        });

        const htmlInjectChain = new AsyncChain();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Fetch.requestPaused', async (event: any) => {
            const { requestId, responseStatusCode, responseHeaders, request } = event;
            const url = request?.url as string ?? '';

            if (responseStatusCode !== undefined) {
                if (responseStatusCode >= 300 && responseStatusCode < 400) {
                    try { await cdp.send('Fetch.continueResponse', { requestId }); } catch { /* best-effort */ }
                    return;
                }

                if (mainFrameId && event.frameId !== mainFrameId) {
                    try { await cdp.send('Fetch.continueResponse', { requestId }); } catch { /* best-effort */ }
                    return;
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ct: string = (responseHeaders as any[] ?? [])
                    .find((h: any) => h.name.toLowerCase() === 'content-type')?.value ?? '';

                if (!ct.includes('text/html')) {
                    try { await cdp.send('Fetch.continueResponse', { requestId }); } catch { /* best-effort */ }
                    return;
                }

                try {
                    await htmlInjectChain.run(async () => {
                        const { body, base64Encoded } = await cdp.send('Fetch.getResponseBody', { requestId });
                        const html    = base64Encoded
                            ? Buffer.from(body as string, 'base64').toString('utf-8')
                            : (body as string);
                        const patched = NavigationGuard.injectScriptTags(html, scripts);

                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const headers = (responseHeaders as any[] ?? [])
                            .filter((h: any) => !['content-encoding', 'content-length']
                                .includes(h.name.toLowerCase()));

                        await cdp.send('Fetch.fulfillRequest', {
                            requestId,
                            responseCode:    responseStatusCode,
                            responseHeaders: headers,
                            body:            Buffer.from(patched, 'utf-8').toString('base64'),
                        });
                        console.log(`[${sessionId}] HTML injected: ${scripts.length} script tag(s)`);
                    });
                } catch (err) {
                    console.warn(`[${sessionId}] HTML injection failed:`, (err as Error).message);
                    try { await cdp.send('Fetch.continueResponse', { requestId }); } catch { /* best-effort */ }
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
                                { name: 'content-type',  value: 'text/javascript; charset=utf-8' },
                                { name: 'cache-control', value: 'no-store' },
                            ],
                            body: Buffer.from(script.content, 'utf-8').toString('base64'),
                        });
                        console.log(`[${sessionId}] Served from memory: ${pathname}`);
                        return;
                    }
                } catch { /* invalid URL — fall through */ }
            }

            if (hasGuard && url && (url.startsWith('http://') || url.startsWith('https://'))) {
                const isMainFrame = !mainFrameId || event.frameId === mainFrameId;

                if (isMainFrame) {
                    try {
                        const host = new URL(url).hostname;
                        if (!NavigationGuard.matchesAllowedDomain(host, allowedNavigationDomains!)) {
                            console.log(
                                `[${sessionId}] Navigation blocked: '${host}' ∉ allowed domains → client redirect`,
                            );
                            if (ws.readyState === ws.OPEN)
                                ws.send(encodeRedirectFrame(url), { binary: true });
                            await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
                            return;
                        }
                    } catch { /* malformed URL — fall through */ }
                }
            }

            try { await cdp.send('Fetch.continueRequest', { requestId }); } catch { /* best-effort */ }
        });
    }

    /**
     * Catches browser-level popups and redirects the main tab (Layer 2).
     */
    static setupTabInterception(
        context:   BrowserContext,
        page:      Page,
        sessionId: string,
    ): void {
        context.on('page', (newPage) => {
            if (newPage === page) return;

            (async () => {
                let targetUrl: string | null = null;
                try {
                    await newPage.waitForURL(
                        (u: URL) => u.protocol !== 'about:' && u.protocol !== 'chrome:',
                        { timeout: 2_000 },
                    );
                    targetUrl = newPage.url();
                } catch {
                    try { targetUrl = newPage.url(); } catch { /* page gone */ }
                }

                try { await newPage.close(); } catch { /* already closed */ }

                if (!targetUrl                              ||
                    targetUrl.startsWith('about:')         ||
                    targetUrl.startsWith('chrome:')        ||
                    targetUrl.startsWith('chrome-extension://')) {
                    return;
                }

                if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))
                    return;

                console.log(`[${sessionId}] Extra tab intercepted → navigating main tab to ${targetUrl}`);

                try {
                    await page.goto(targetUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout:   30_000,
                    });
                } catch { /* navigation error — main tab may have already moved */ }
            })().catch(err => {
                console.warn(`[${sessionId}] Tab-interception error:`, (err as Error).message);
            });
        });
    }

    static matchesAllowedDomain(host: string, patterns: string[]): boolean {
        const normalizedHost = host.toLowerCase();
        for (const pattern of patterns) {
            if (!pattern) continue;
            const normalizedPattern = pattern.toLowerCase();
            if (normalizedPattern.startsWith('*.')) {
                const suffix = normalizedPattern.slice(2);
                if (normalizedHost.endsWith('.' + suffix)) return true;
            } else if (normalizedHost === normalizedPattern) {
                return true;
            }
        }
        return false;
    }

    private static injectScriptTags(html: string, scripts: ScriptEntry[]): string {
        const groups: Record<string, ScriptEntry[]> = {
            HeaderTop:    [],
            HeaderBottom: [],
            BodyTop:      [],
            BodyBottom:   [],
        };
        for (const s of scripts) {
            if (s.position in groups) groups[s.position].push(s);
        }

        const toTag = (s: ScriptEntry): string =>
            s.type === 'Module'
                ? `<script type="module" src="${s.file}"></script>`
                : `<script src="${s.file}"></script>`;

        const block = (entries: ScriptEntry[]): string =>
            entries.map(toTag).join('\n');

        let result = html;
        const ht = block(groups.HeaderTop);
        const hb = block(groups.HeaderBottom);
        const bt = block(groups.BodyTop);
        const bb = block(groups.BodyBottom);

        if (ht) result = result.replace(/(<head\b[^>]*>)/i,  `$1\n${ht}`);
        if (hb) result = result.replace(/(<\/head>)/i,        `${hb}\n$1`);
        if (bt) result = result.replace(/(<body\b[^>]*>)/i,  `$1\n${bt}`);
        if (bb) result = result.replace(/(<\/body>)/i,        `${bb}\n$1`);

        return result;
    }
}
