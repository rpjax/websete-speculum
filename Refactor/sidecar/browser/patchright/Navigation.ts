import type { BrowserContext, CDPSession, Page } from 'patchright';
import type { BrowserScriptInjection, BrowserSessionEvents } from '../BrowserSession';
import { injectScriptTags } from './ChromeRuntime';

export function matchesAllowedDomain(host: string, patterns: readonly string[]): boolean {
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

export class Navigation {
  private mainFrameId: string | undefined;

  constructor(
    private readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
  ) {}

  async setupSingleTab(context: BrowserContext): Promise<void> {
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

  setupTabInterception(context: BrowserContext, page: Page): void {
    context.on('page', (newPage) => {
      if (newPage === page) return;
      void (async () => {
        let targetUrl: string | null = null;
        try {
          await newPage.waitForURL(
            (u: URL) => u.protocol !== 'about:' && u.protocol !== 'chrome:',
            { timeout: 2_000 },
          );
          targetUrl = newPage.url();
        } catch {
          try {
            targetUrl = newPage.url();
          } catch {
            /* gone */
          }
        }
        try {
          await newPage.close();
        } catch {
          /* */
        }
        if (targetUrl && /^https?:/i.test(targetUrl)) {
          try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          } catch {
            /* */
          }
        }
      })();
    });
  }

  setupLocationSync(page: Page): void {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = page.url();
      if (!/^https?:\/\//i.test(url)) return;
      this.events.onLocationChanged(url);
    });
  }

  async setupFetchGuard(
    cdp: CDPSession,
    scripts: readonly BrowserScriptInjection[],
    allowedNavigationDomains: readonly string[] | undefined,
  ): Promise<void> {
    const scriptMap = new Map(scripts.map((s) => [s.file, s] as const));
    const hasScripts = scripts.length > 0;
    const hasGuard = !!allowedNavigationDomains && allowedNavigationDomains.length > 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patterns: any[] = [];
    for (const s of scripts) {
      patterns.push({ requestStage: 'Request', urlPattern: `*${s.file}*` });
    }
    if (hasGuard) patterns.push({ requestStage: 'Request', resourceType: 'Document' });
    if (hasScripts) patterns.push({ requestStage: 'Response', resourceType: 'Document' });
    if (patterns.length === 0) return;

    await cdp.send('Page.enable', {});
    await cdp.send('Fetch.enable', { patterns });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { frameTree } = (await cdp.send('Page.getFrameTree', {})) as any;
      this.mainFrameId = frameTree?.frame?.id as string | undefined;
    } catch {
      /* */
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdp.on('Page.frameNavigated', (event: any) => {
      const frame = event?.frame;
      if (frame && !frame.parentId) this.mainFrameId = frame.id as string;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdp.on('Fetch.requestPaused', async (event: any) => {
      const { requestId, responseStatusCode, responseHeaders, request } = event;
      const url = (request?.url as string) ?? '';

      if (responseStatusCode !== undefined) {
        if (responseStatusCode >= 300 && responseStatusCode < 400) {
          try {
            await cdp.send('Fetch.continueResponse', { requestId });
          } catch {
            /* */
          }
          return;
        }
        if (this.mainFrameId && event.frameId !== this.mainFrameId) {
          try {
            await cdp.send('Fetch.continueResponse', { requestId });
          } catch {
            /* */
          }
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ct: string =
          (responseHeaders as any[] ?? []).find(
            (h: any) => h.name.toLowerCase() === 'content-type',
          )?.value ?? '';
        if (!ct.includes('text/html') || !hasScripts) {
          try {
            await cdp.send('Fetch.continueResponse', { requestId });
          } catch {
            /* */
          }
          return;
        }
        try {
          const { body, base64Encoded } = await cdp.send('Fetch.getResponseBody', { requestId });
          const html = base64Encoded
            ? Buffer.from(body as string, 'base64').toString('utf-8')
            : (body as string);
          const patched = injectScriptTags(html, scripts);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const headers = (responseHeaders as any[] ?? []).filter(
            (h: any) => !['content-encoding', 'content-length'].includes(h.name.toLowerCase()),
          );
          await cdp.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: responseStatusCode,
            responseHeaders: headers,
            body: Buffer.from(patched, 'utf-8').toString('base64'),
          });
        } catch {
          try {
            await cdp.send('Fetch.continueResponse', { requestId });
          } catch {
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
        } catch {
          /* */
        }
      }

      if (hasGuard && url && (url.startsWith('http://') || url.startsWith('https://'))) {
        const isMainFrame = !this.mainFrameId || event.frameId === this.mainFrameId;
        if (isMainFrame) {
          try {
            const host = new URL(url).hostname;
            if (!matchesAllowedDomain(host, allowedNavigationDomains!)) {
              console.log(
                `[${this.sessionId}] Navigation blocked: '${host}' ∉ allowed domains`,
              );
              this.events.onMainFrameNavigationBlocked(url);
              await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
              return;
            }
          } catch {
            /* */
          }
        }
      }

      try {
        await cdp.send('Fetch.continueRequest', { requestId });
      } catch {
        /* */
      }
    });
  }
}
