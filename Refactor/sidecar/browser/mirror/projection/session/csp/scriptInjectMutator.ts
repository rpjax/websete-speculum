/**
 * Launch script-tag inject for Document Response mutate (PP / shared Chromium path).
 * Pairs with {@link installDocumentResponseHook}; does not open a second Fetch.enable.
 */

import type { BrowserScriptInjection } from '../../../../BrowserSession';
import { injectScriptTags } from '../../../../patchright/ChromeRuntime';
import { scriptMatchesUrl } from '../../../../patchright/Navigation';
import type { DocumentResponseContext, DocumentResponseMutator } from './documentResponseHook';

/**
 * Inject matching stored/remote script tags into main-document HTML.
 * Empty scripts → no-op mutator (changed=false).
 */
export function createScriptInjectMutator(
  scripts: readonly BrowserScriptInjection[],
): DocumentResponseMutator {
  if (scripts.length === 0) {
    return (ctx) => ({ headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false });
  }
  return (ctx: DocumentResponseContext) => {
    let documentUrl: URL;
    try {
      documentUrl = new URL(ctx.url);
    } catch {
      return { headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false };
    }
    const matched = scripts.filter((s) => scriptMatchesUrl(s, documentUrl));
    if (matched.length === 0) {
      return { headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false };
    }
    const patched = injectScriptTags(ctx.bodyHtml, matched);
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
