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

import type { BrowserContext, CDPSession, Frame, Page } from 'patchright';
import {
  rewriteCspMetasInHtml,
  rewriteCspResponseHeaders,
  type CspHeader,
} from './relaxCsp';
import { cspDiagLog } from './cspDiag';
import {
  attachFrameCdp,
  createFrameCdpAttachState,
  wireFrameCdpLifecycle,
  type FrameCdpAttachState,
} from '../frameCdpSession';

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
  /**
   * When set with {@link page}, attach the same Fetch hook to OOPIF frames via
   * `context.newCDPSession(frame)`.
   */
  context?: BrowserContext | null;
  /** Page whose frames receive per-frame CDP Fetch (main session covers root). */
  page?: Page | null;
};

type CdpSender = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

type HookState = {
  // CDP RequestPattern — kept loose (Patchright typings vary by version).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patterns: any[];
  mutators: DocumentResponseMutator[];
  frameState: FrameCdpAttachState;
  /** Sessions that already have a Fetch.requestPaused listener (no stacking). */
  pausedBound: WeakSet<CDPSession>;
};

const byPageCdp = new WeakMap<CDPSession, HookState>();

const DOCUMENT_RESPONSE_PATTERNS = [{ requestStage: 'Response', resourceType: 'Document' }];

/** @internal Exported for unit tests — Document Response paused handler. */
export async function handleDocumentResponsePausedForTest(
  send: CdpSender,
  event: {
    requestId?: string;
    responseStatusCode?: number;
    responseHeaders?: Array<{ name?: string; value?: string }>;
    request?: { url?: string };
  },
  mutators: DocumentResponseMutator[],
): Promise<void> {
  return handleRequestPaused(send, event, mutators);
}

async function handleRequestPaused(
  send: CdpSender,
  event: {
    requestId?: string;
    responseStatusCode?: number;
    responseHeaders?: Array<{ name?: string; value?: string }>;
    request?: { url?: string };
  },
  mutators: DocumentResponseMutator[],
): Promise<void> {
  const requestId = event?.requestId;
  if (!requestId) return;

  const responseStatusCode = event?.responseStatusCode;
  if (responseStatusCode === undefined) {
    try {
      await send('Fetch.continueRequest', { requestId });
    } catch {
      /* session tearing down */
    }
    return;
  }

  const continueResponse = async () => {
    try {
      await send('Fetch.continueResponse', { requestId });
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

  /** Header-only continue — used when body get/fulfill fails (huge Document, CDP limits). */
  const continueWithHeaders = async (nextHeaders: CspHeader[]) => {
    await send('Fetch.continueResponse', {
      requestId,
      responseCode: responseStatusCode,
      responseHeaders: nextHeaders,
    });
  };

  const headerOnly = rewriteCspResponseHeaders(headers);
  const docUrl = event?.request?.url ?? '';
  cspDiagLog('document paused', {
    url: docUrl.slice(0, 120),
    status: responseStatusCode,
    headerCsp: headerOnly.cspChanged,
  });

  try {
    const { body, base64Encoded } = (await send('Fetch.getResponseBody', {
      requestId,
    })) as { body: string; base64Encoded: boolean };
    const bodyHtml = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;

    let ctx: DocumentResponseContext = {
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
      if (result.changed) changed = true;
    }

    if (!changed) {
      cspDiagLog('document unchanged continue', { url: docUrl.slice(0, 120) });
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
      cspDiagLog('document fulfill ok', { url: docUrl.slice(0, 120), changed });
    } catch (fulfillErr) {
      cspDiagLog('document fulfill failed', {
        url: docUrl.slice(0, 120),
        err: fulfillErr instanceof Error ? fulfillErr.message : String(fulfillErr),
        headerFallback: headerOnly.cspChanged,
      });
      if (headerOnly.cspChanged) {
        await continueWithHeaders(headerOnly.headers);
      } else {
        await continueResponse();
      }
    }
  } catch (bodyErr) {
    cspDiagLog('getResponseBody failed', {
      url: docUrl.slice(0, 120),
      err: bodyErr instanceof Error ? bodyErr.message : String(bodyErr),
      headerFallback: headerOnly.cspChanged,
    });
    if (headerOnly.cspChanged) {
      await continueWithHeaders(headerOnly.headers);
    } else {
      await continueResponse();
    }
  }
}

async function enableFetchOnSession(session: CDPSession, state: HookState): Promise<void> {
  await session.send('Fetch.enable', { patterns: state.patterns });
  if (state.pausedBound.has(session)) return;
  state.pausedBound.add(session);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session.on('Fetch.requestPaused', async (event: any) => {
    const send: CdpSender = (method, params) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).send(method, params);
    await handleRequestPaused(send, event, state.mutators);
  });
}

async function attachFrameFetch(
  frame: Frame,
  page: Page,
  context: BrowserContext,
  state: HookState,
): Promise<void> {
  const frameCdp = await attachFrameCdp(frame, page, context, state.frameState);
  if (frameCdp) await enableFetchOnSession(frameCdp, state);
}

/**
 * Enable Fetch on Document Response and attach CSP mutators.
 * Also attaches the same Fetch hook to OOPIF frames when `page` + `context` are provided.
 */
export async function installDocumentResponseHook(
  cdp: CDPSession,
  opts?: InstallDocumentResponseHookOptions,
): Promise<void> {
  const mutators = opts?.mutators ?? [cspDocumentMutator];
  const context = opts?.context ?? null;
  const page = opts?.page ?? null;

  let state = byPageCdp.get(cdp);
  if (!state) {
    state = {
      patterns: DOCUMENT_RESPONSE_PATTERNS,
      mutators,
      frameState: createFrameCdpAttachState(),
      pausedBound: new WeakSet(),
    };
    byPageCdp.set(cdp, state);
  } else {
    state.mutators = mutators;
  }

  await enableFetchOnSession(cdp, state);

  if (page && context) {
    await wireFrameCdpLifecycle({
      page,
      context,
      state: state.frameState,
      onFrameSession: (frame) => attachFrameFetch(frame, page, context, state!),
      onMainFrameNavigated: () => enableFetchOnSession(cdp, state!),
    });
  }
}
