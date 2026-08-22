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

import type { CDPSession } from 'patchright';
import {
  rewriteCspMetasInHtml,
  rewriteCspResponseHeaders,
  type CspHeader,
} from './relaxCsp';

export type DocumentResponseContext = {
  url: string;
  statusCode: number;
  headers: CspHeader[];
  bodyHtml: string;
};

export type DocumentResponseMutator = (ctx: DocumentResponseContext) => {
  headers: CspHeader[];
  bodyHtml: string;
  changed: boolean;
};

/** CSP surgical mutator — enforcing headers + meta; Report-Only left alone. */
export function cspDocumentMutator(ctx: DocumentResponseContext): {
  headers: CspHeader[];
  bodyHtml: string;
  changed: boolean;
} {
  const { headers, cspChanged } = rewriteCspResponseHeaders(ctx.headers);
  const meta = rewriteCspMetasInHtml(ctx.bodyHtml);
  return {
    headers,
    bodyHtml: meta.html,
    changed: cspChanged || meta.changed,
  };
}

export type InstallDocumentResponseHookOptions = {
  mutators?: DocumentResponseMutator[];
};

/**
 * Enable Fetch on Document Response and attach the mutator pipeline.
 * Idempotent per CDP session only if called once — caller owns lifecycle with the page.
 */
export async function installDocumentResponseHook(
  cdp: CDPSession,
  opts?: InstallDocumentResponseHookOptions,
): Promise<void> {
  const mutators = opts?.mutators ?? [cspDocumentMutator];

  await cdp.send('Fetch.enable', {
    patterns: [{ requestStage: 'Response', resourceType: 'Document' }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cdp.on('Fetch.requestPaused', async (event: any) => {
    const requestId = event?.requestId as string | undefined;
    if (!requestId) return;

    const responseStatusCode = event?.responseStatusCode as number | undefined;
    // Request-stage events must never be fulfilled here — Document pattern is Response-only,
    // but continue defensively if CDP delivers an unexpected pause.
    if (responseStatusCode === undefined) {
      try {
        await cdp.send('Fetch.continueRequest', { requestId });
      } catch {
        /* session tearing down */
      }
      return;
    }

    const continueResponse = async () => {
      try {
        await cdp.send('Fetch.continueResponse', { requestId });
      } catch {
        /* */
      }
    };

    if (responseStatusCode >= 300 && responseStatusCode < 400) {
      await continueResponse();
      return;
    }

    const rawHeaders = (event?.responseHeaders ?? []) as Array<{ name?: string; value?: string }>;
    const headers: CspHeader[] = rawHeaders
      .filter((h) => !!h.name?.trim())
      .map((h) => ({ name: h.name!.trim(), value: h.value ?? '' }));

    const ct =
      headers.find((h) => h.name.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      await continueResponse();
      return;
    }

    try {
      const { body, base64Encoded } = (await cdp.send('Fetch.getResponseBody', {
        requestId,
      })) as { body: string; base64Encoded: boolean };
      const bodyHtml = base64Encoded
        ? Buffer.from(body, 'base64').toString('utf-8')
        : body;

      let ctx: DocumentResponseContext = {
        url: (event?.request?.url as string) ?? '',
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
        if (result.changed) changed = true;
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
    } catch {
      await continueResponse();
    }
  });
}
