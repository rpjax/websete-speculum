/**
 * Projected blank iframe bootstrap (K4 / frame-protocol §1.2).
 *
 * One mechanism for root surface, nested hosts, and resync standbys:
 * stamp `srcdoc` **before** insert so the first navigation is already standards mode.
 * Never `document.open` / `document.write` — those orphan the Document inside nested
 * browsing contexts (`defaultView` null → `createDocumentType` null).
 *
 * Callers: create → set {@link PROJECTED_STANDARDS_SRCDOC} → insert →
 * {@link whenProjectedStandardsReady} → apply into the stripped document.
 */

/** Minimal HTML5 document — parses CSS1Compat; skeleton is stripped before table apply. */
export const PROJECTED_STANDARDS_SRCDOC =
  '<!DOCTYPE html><html><head></head><body></body></html>';

/**
 * Budget for srcdoc birth → live CSS1Compat document.
 * Same discipline as `initContext`: hang forever is worse than a catalogued fault.
 */
export const PROJECTED_STANDARDS_READY_TIMEOUT_MS = 5_000;

export type ProjectedStandardsReadyErrorCode =
  | 'projected_standards_ready_timeout'
  | 'projected_standards_ready_aborted'
  | 'projected_standards_ready_invalid';

export type ProjectedStandardsReadyError = Error & {
  errorCode: ProjectedStandardsReadyErrorCode;
  phase: 'establish';
};

function fault(
  errorCode: ProjectedStandardsReadyErrorCode,
  message: string,
): ProjectedStandardsReadyError {
  const err = new Error(message) as ProjectedStandardsReadyError;
  err.errorCode = errorCode;
  err.phase = 'establish';
  return err;
}

/** Stamp standards `srcdoc` before the iframe is inserted (or to re-seed after a lost context). */
export function stampProjectedStandardsSrcdoc(iframe: HTMLIFrameElement): void {
  iframe.srcdoc = PROJECTED_STANDARDS_SRCDOC;
}

/** Remove the srcdoc skeleton so a resync/cold frame owns the tree under id 1. */
export function stripProjectedSkeleton(doc: Document): void {
  while (doc.firstChild) doc.removeChild(doc.firstChild);
}

/**
 * True when the iframe's live document is standards mode with a browsing context.
 * Sync `contentDocument` right after insert is often still the transient `about:blank`
 * (BackCompat) — do not adopt that; wait for load / this predicate.
 */
export function isProjectedStandardsDocument(doc: Document | null | undefined): doc is Document {
  return doc != null && doc.defaultView != null && doc.compatMode === 'CSS1Compat';
}

export type WhenProjectedStandardsReadyOpts = {
  timeoutMs?: number;
  /** Cancel wait (iframe dropped, surface superseded). Settles with `projected_standards_ready_aborted`. */
  signal?: AbortSignal;
};

/**
 * After srcdoc birth (or re-stamp): wait until the live document is CSS1Compat with a
 * browsing context, strip the skeleton, return that document.
 *
 * Always settles: load, adopt-already-ready, timeout, abort, or invalid load document.
 * Removes the `load` listener and clears the deadline timer on settle.
 */
export function whenProjectedStandardsReady(
  iframe: HTMLIFrameElement,
  opts: WhenProjectedStandardsReadyOpts = {},
): Promise<Document> {
  const timeoutMs = opts.timeoutMs ?? PROJECTED_STANDARDS_READY_TIMEOUT_MS;
  const signal = opts.signal;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      iframe.removeEventListener('load', onLoad);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const adopt = (): boolean => {
      const doc = iframe.contentDocument;
      if (!isProjectedStandardsDocument(doc)) return false;
      stripProjectedSkeleton(doc);
      settle(() => resolve(doc));
      return true;
    };

    const onLoad = (): void => {
      if (adopt()) return;
      settle(() =>
        reject(
          fault(
            'projected_standards_ready_invalid',
            'projected blank: load without live CSS1Compat document',
          ),
        ),
      );
    };

    const onAbort = (): void => {
      settle(() =>
        reject(
          fault(
            'projected_standards_ready_aborted',
            'projected blank: standards ready wait aborted',
          ),
        ),
      );
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    if (adopt()) return;

    iframe.addEventListener('load', onLoad);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      settle(() =>
        reject(
          fault(
            'projected_standards_ready_timeout',
            `projected blank: standards document not ready within ${timeoutMs}ms`,
          ),
        ),
      );
    }, timeoutMs);
  });
}
