import type { BrowserContext, CDPSession, Page } from 'patchright';
import type {
  BrowserDomainPattern,
  BrowserPathPattern,
  BrowserScriptInjection,
  BrowserSessionEvents,
  BrowserUrlMatchRule,
} from '../BrowserSession';
import { injectScriptTags } from './ChromeRuntime';

const PERMISSIVE_MAIN_FRAME_CSP = [
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "script-src-elem * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "script-src-attr * 'unsafe-inline'",
  "connect-src * data: blob: ws: wss:",
].join('; ');

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

/** True when url is http(s) main-document and host ∉ allowlist. */
export function isMainFrameNavigationBlocked(
  url: string,
  allowedNavigationDomains: readonly string[],
): boolean {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  if (!allowedNavigationDomains.length) return false;
  try {
    return !matchesAllowedDomain(new URL(url).hostname, allowedNavigationDomains);
  } catch {
    return false;
  }
}

export type MainFrameDomainGuardOpts = {
  allowedNavigationDomains: readonly string[];
  onBlocked: (url: string) => void;
  /** Optional log prefix (session id). */
  sessionId?: string;
};

type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/**
 * Request-stage Document domain allowlist (no CSP / script fulfill).
 * Safe to use alone, or call {@link tryBlockPausedMainFrameDocument} from a shared
 * Fetch.requestPaused handler that also owns Response-stage patterns (PP CSP hook).
 */
export async function installMainFrameDomainGuard(
  cdp: CDPSession,
  opts: MainFrameDomainGuardOpts,
): Promise<void> {
  const allowed = opts.allowedNavigationDomains;
  if (!allowed.length) return;

  await cdp.send('Page.enable', {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await cdp.send('Fetch.enable', {
    patterns: [{ requestStage: 'Request', resourceType: 'Document' }],
  });

  let mainFrameId: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { frameTree } = (await cdp.send('Page.getFrameTree', {})) as any;
    mainFrameId = frameTree?.frame?.id as string | undefined;
  } catch {
    /* */
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cdp.on('Page.frameNavigated', (event: any) => {
    const frame = event?.frame;
    if (frame && !frame.parentId) mainFrameId = frame.id as string;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cdp.on('Fetch.requestPaused', async (event: any) => {
    const send: CdpSend = (method, params) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cdp as any).send(method, params);
    const blocked = await tryBlockPausedMainFrameDocument(send, event, {
      allowedNavigationDomains: allowed,
      onBlocked: opts.onBlocked,
      sessionId: opts.sessionId,
      mainFrameId,
    });
    if (blocked) return;
    const requestId = event?.requestId as string | undefined;
    if (!requestId) return;
    try {
      await send('Fetch.continueRequest', { requestId });
    } catch {
      /* */
    }
  });
}

/**
 * If this paused event is a main-frame Document Request to a disallowed host,
 * fail the request, emit onBlocked, return true. Otherwise return false (caller continues).
 */
export async function tryBlockPausedMainFrameDocument(
  send: CdpSend,
  event: {
    requestId?: string;
    responseStatusCode?: number;
    frameId?: string;
    request?: { url?: string };
  },
  opts: MainFrameDomainGuardOpts & { mainFrameId?: string },
): Promise<boolean> {
  if (event.responseStatusCode !== undefined) return false;
  const url = event.request?.url ?? '';
  const requestId = event.requestId;
  if (!requestId || !url) return false;
  if (!opts.allowedNavigationDomains.length) return false;

  const isMainFrame = !opts.mainFrameId || event.frameId === opts.mainFrameId;
  if (!isMainFrame) return false;
  if (!isMainFrameNavigationBlocked(url, opts.allowedNavigationDomains)) return false;

  if (opts.sessionId) {
    try {
      const host = new URL(url).hostname;
      console.log(`[${opts.sessionId}] Navigation blocked: '${host}' ∉ allowed domains`);
    } catch {
      /* */
    }
  }
  opts.onBlocked(url);
  try {
    await send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
  } catch {
    /* */
  }
  return true;
}

export function relaxMainFrameCspHeaders(
  responseHeaders: Array<{ name?: string; value?: string }> | undefined,
): Array<{ name: string; value: string }> {
  const kept: Array<{ name: string; value: string }> = [];
  for (const header of responseHeaders ?? []) {
    const name = header.name?.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
      continue;
    }
    kept.push({ name, value: header.value ?? '' });
  }
  kept.push({ name: 'Content-Security-Policy', value: PERMISSIVE_MAIN_FRAME_CSP });
  return kept;
}

export function injectPermissiveMainFrameCsp(html: string): string {
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
export function scriptMatchesUrl(script: BrowserScriptInjection, url: URL): boolean {
  if (!script.targetRules?.length) {
    return false;
  }

  return script.targetRules.some((rule) => urlRuleMatches(rule, url));
}

export function urlRuleMatches(rule: BrowserUrlMatchRule, url: URL): boolean {
  return domainMatches(rule.domain, url.hostname) && pathMatches(rule.path, url.pathname);
}

/**
 * Domain match aligned with UrlResolver:
 * - Scope Any → all hosts
 * - Leading label Any (*.apex) → host EndsWith(".apex") and host !== apex
 * - All Exact → exact host equality
 * - Mid-label Any → reject (not supported)
 */
export function domainMatches(pattern: BrowserDomainPattern, host: string): boolean {
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
    const apexParts: string[] = [];
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

export function pathMatches(pattern: BrowserPathPattern, pathname: string): boolean {
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

function normalizeScope(value: string | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'any') return 'Any';
  if (v === 'pattern') return 'Pattern';
  return value ?? '';
}

function normalizeMatch(value: string | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'any') return 'Any';
  if (v === 'exact') return 'Exact';
  return value ?? '';
}

function normalizeMatchType(value: string | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'exact') return 'Exact';
  if (v === 'prefix') return 'Prefix';
  return value ?? 'Prefix';
}

export class Navigation {
  private mainFrameId: string | undefined;

  constructor(
    private readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
  ) {}

  async setupSingleTab(context: BrowserContext): Promise<void> {
    // PageProjection: single-tab law is enforced by speculum-pp `main/single-tab.js` (extension
    // MAIN, all_frames). CDP addInitScript here is video-streaming only — same carrier family
    // banned on PP boot (runtime-redesign.md §15.7).
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

  setupTabInterception(
    context: BrowserContext,
    page: Page,
    allowedNavigationDomains?: readonly string[],
  ): void {
    const allowed = allowedNavigationDomains ?? [];
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
          // Stayed about:/chrome: — leave alone. PP-EST-7 checksum uses an ephemeral
          // about:blank in this context; closing it mid-walk fails establish.
          return;
        }
        try {
          await newPage.close();
        } catch {
          /* */
        }
        if (targetUrl && /^https?:/i.test(targetUrl)) {
          if (allowed.length > 0 && isMainFrameNavigationBlocked(targetUrl, allowed)) {
            this.events.onMainFrameNavigationBlocked(targetUrl);
            return;
          }
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
      try {
        if (frame !== page.mainFrame()) return;
        const url = page.url();
        if (!/^https?:\/\//i.test(url)) return;
        this.events.onLocationChanged(url);
      } catch {
        /* frame/page can detach mid-navigation */
      }
    });
  }

  async setupFetchGuard(
    cdp: CDPSession,
    scripts: readonly BrowserScriptInjection[],
    allowedNavigationDomains: readonly string[] | undefined,
  ): Promise<void> {
    const storedScripts = scripts.filter((s) => !s.remoteUrl);
    const scriptMap = new Map(storedScripts.map((s) => [s.file, s] as const));
    const hasScripts = storedScripts.length > 0;
    const hasGuard = !!allowedNavigationDomains && allowedNavigationDomains.length > 0;
    // Prefer Page.setBypassCSP so producer / injected scripts run without rewriting
    // every main-frame HTML Document (Fetch.fulfillRequest fingerprints WAFs).
    await cdp.send('Page.enable', {});
    try {
      await cdp.send('Page.setBypassCSP', { enabled: true });
    } catch {
      /* older Chromium — Fetch mutate path below still covers script tags when needed */
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patterns: any[] = [];
    for (const s of storedScripts) {
      patterns.push({ requestStage: 'Request', urlPattern: `*${s.file}*` });
    }
    if (hasGuard) patterns.push({ requestStage: 'Request', resourceType: 'Document' });
    // Document Response mutate only when stored script tags must be injected into HTML.
    // CSP meta/header rewrite is unnecessary when setBypassCSP succeeded.
    if (hasScripts) {
      patterns.push({ requestStage: 'Response', resourceType: 'Document' });
    }
    if (patterns.length === 0) return;

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
        if (!ct.includes('text/html')) {
          try {
            await cdp.send('Fetch.continueResponse', { requestId });
          } catch {
            /* */
          }
          return;
        }
        try {
          const documentUrl = new URL(url);
          const matchedScripts = scripts.filter((script) => scriptMatchesUrl(script, documentUrl));
          if (matchedScripts.length === 0) {
            await cdp.send('Fetch.continueResponse', { requestId });
            return;
          }
          const { body, base64Encoded } = await cdp.send('Fetch.getResponseBody', { requestId });
          const html = base64Encoded
            ? Buffer.from(body as string, 'base64').toString('utf-8')
            : (body as string);
          const patched = injectScriptTags(html, matchedScripts);
          // Keep origin CSP headers when bypass is on; only strip encoding/length for body rewrite.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const headers = ((responseHeaders as any[] ?? []) as Array<{ name?: string; value?: string }>)
            .filter((h) => {
              const n = (h.name ?? '').toLowerCase();
              return n && n !== 'content-encoding' && n !== 'content-length';
            })
            .map((h) => ({ name: h.name!.trim(), value: h.value ?? '' }));
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

      if (hasGuard) {
        const send: CdpSend = (method, params) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cdp as any).send(method, params);
        const blocked = await tryBlockPausedMainFrameDocument(send, event, {
          allowedNavigationDomains: allowedNavigationDomains!,
          onBlocked: (u) => this.events.onMainFrameNavigationBlocked(u),
          sessionId: this.sessionId,
          mainFrameId: this.mainFrameId,
        });
        if (blocked) return;
      }

      try {
        await cdp.send('Fetch.continueRequest', { requestId });
      } catch {
        /* */
      }
    });
  }
}
