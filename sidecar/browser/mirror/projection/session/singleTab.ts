/**
 * PageProjection single-tab policy — **one Chromium page per session, always.**
 *
 * Sidecar law (Rodrigo): a second tab is **forbidden**. `window.open` / `target=_blank`
 * / `_new` must become a **same-tab redirect** (`location` change on the primary page).
 * Never two tabs alive in one session — not even briefly as a “real” surface.
 *
 * Primary path: single-tab body in the unified CDP inject bundle rewrites open/_blank
 * before the browser allocates a new top-level browsing context.
 *
 * Safety net: if Chromium still creates a page (`context.on('page')`), **close it
 * immediately** and adopt its http(s) URL onto the primary via `page.goto` (not `freshPage`).
 * That net is for paths the init script cannot see; it is not a second supported tab.
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
 * Safety net when init rewrite did not run or site bypassed it.
 * Closes auxiliary pages immediately; never leaves two tabs in the context.
 */
export function installSingleTabAdoption(opts: InstallSingleTabAdoptionOptions): void {
  const { page, context, adoptUrlOnPrimary } = opts;
  const existing = adoptionByContext.get(context);
  if (existing) {
    existing.primary = page;
    existing.adoptUrlOnPrimary = adoptUrlOnPrimary;
    return;
  }

  const state: AdoptionState = { primary: page, adoptUrlOnPrimary };
  adoptionByContext.set(context, state);

  context.on('page', (newPage) => {
    const s = adoptionByContext.get(context);
    if (!s || newPage === s.primary) return;

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
