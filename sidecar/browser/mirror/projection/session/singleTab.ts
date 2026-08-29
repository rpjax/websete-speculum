/**
 * PageProjection single-tab policy — **one Chromium page per session, always.**
 *
 * Sidecar law (Rodrigo): a second tab is **forbidden**. `window.open` / `target=_blank`
 * / `_new` must become a **same-tab redirect** (`location` change on the primary page).
 * Never two tabs alive in one session — not even briefly as a “real” surface.
 *
 * Primary path: single-tab body in the unified CDP inject bundle / extension MAIN rewrites
 * open/_blank before the browser allocates a new top-level browsing context.
 *
 * Safety net: if Chromium still creates a page (`context.on('page')`), **close it
 * immediately** and adopt its http(s) URL onto the primary via `page.goto` (not `freshPage`).
 * That net is for paths the init script cannot see; it is not a second supported tab.
 *
 * **`freshPage` must suspend the net** while it creates the replacement primary — otherwise
 * the handler closes the new tab, then closes the old one, Chrome ends with zero pages and
 * the context disconnects (`browser_disconnected` on lab browse.navigate).
 *
 * Provenance: legacy `patchright/Navigation.ts` — V4 has no PERMISSIVE CSP coupling.
 */

import type { BrowserContext, Page } from 'patchright';

/** Init script: rewrite open/_blank/_new into same-tab navigations before parse. */
export const SINGLE_TAB_INIT_SCRIPT = `
(function () {
  'use strict';
  try {
    Object.defineProperty(window, 'opener', {
      value: null, writable: false, configurable: false,
    });
  } catch (_) {}
  var _origOpen = window.open.bind(window);
  window.open = function speculum_single_tab_open(url, target, features) {
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
`;

type AdoptionState = {
  primary: Page;
  adoptUrlOnPrimary: (url: string) => Promise<void>;
  /** True while {@link beginPrimaryPageReplace} … {@link commitPrimaryPageReplace}. */
  replacing: boolean;
};

const adoptionByContext = new WeakMap<BrowserContext, AdoptionState>();

export type InstallSingleTabAdoptionOptions = {
  /** Primary page that owns the session surface / data plane. */
  page: Page;
  context: BrowserContext;
  /**
   * Navigate **the same** primary page to the auxiliary URL (keep CDP Fetch hook).
   * Must not recreate the page.
   */
  adoptUrlOnPrimary: (url: string) => Promise<void>;
};

function readHttpUrl(page: Page): string | null {
  try {
    const u = page.url();
    return /^https?:/i.test(u) ? u : null;
  } catch {
    return null;
  }
}

/**
 * Suspend the orphan-tab closer while session code creates a replacement primary
 * (`PageProjectionBrowserSession.freshPage`).
 */
export function beginPrimaryPageReplace(context: BrowserContext): void {
  const s = adoptionByContext.get(context);
  if (s) s.replacing = true;
}

/**
 * Point the net at the new primary and re-arm orphan close.
 */
export function commitPrimaryPageReplace(
  context: BrowserContext,
  page: Page,
  adoptUrlOnPrimary: (url: string) => Promise<void>,
): void {
  const s = adoptionByContext.get(context);
  if (!s) return;
  s.primary = page;
  s.adoptUrlOnPrimary = adoptUrlOnPrimary;
  s.replacing = false;
}

/** Clear the replace suspend without changing primary (error path in `freshPage`). */
export function abortPrimaryPageReplace(context: BrowserContext): void {
  const s = adoptionByContext.get(context);
  if (s) s.replacing = false;
}

/**
 * Safety net when init rewrite did not run or site bypassed it.
 * Closes auxiliary pages immediately; never leaves two tabs in the context.
 */
export function installSingleTabAdoption(opts: InstallSingleTabAdoptionOptions): void {
  const { page, context, adoptUrlOnPrimary } = opts;
  const existing = adoptionByContext.get(context);
  if (existing) {
    existing.primary = page;
    existing.adoptUrlOnPrimary = adoptUrlOnPrimary;
    existing.replacing = false;
    return;
  }

  const state: AdoptionState = { primary: page, adoptUrlOnPrimary, replacing: false };
  adoptionByContext.set(context, state);

  context.on('page', (newPage) => {
    const s = adoptionByContext.get(context);
    if (!s || s.replacing || newPage === s.primary) return;

    void (async () => {
      // Capture intended URL in parallel; close immediately — never two session tabs.
      const urlCapture = (async (): Promise<string | null> => {
        const immediate = readHttpUrl(newPage);
        if (immediate) return immediate;
        try {
          await newPage.waitForURL((u: URL) => /^https?:/.test(u.protocol), { timeout: 600 });
          return readHttpUrl(newPage);
        } catch {
          return readHttpUrl(newPage);
        }
      })();
      void newPage.close({ runBeforeUnload: false }).catch(() => {});
      const targetUrl = await urlCapture;
      if (targetUrl) {
        try {
          await s.adoptUrlOnPrimary(targetUrl);
        } catch {
          /* navigation blocked / tearing down */
        }
      }
    })();
  });
}
