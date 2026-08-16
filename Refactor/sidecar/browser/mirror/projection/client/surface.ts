/**
 * Lab surface — real double buffer (Stage 4, frame-protocol-production-completeness, §5.8
 * "Client side"). One visible (active) iframe plus, only while a resync build is in flight, one
 * invisible (standby) iframe: `beginResyncBuild()` builds a whole new document in the standby
 * iframe via the ordinary two-phase apply (§6), completely isolated from the currently visible
 * surface; `commitSwap()` promotes it after the resync frame's own closing `CHECK` verifies OK
 * (§5.8: "the new condition is this frame's closing CHECK verifies OK"), tearing down the old
 * active iframe in the same call — a single reflow, not a new "reconnect the root" instruction.
 * `discardBuild()` drops an abandoned/failed build without ever touching the visible surface —
 * the whole point of building off-surface: Phase 2 "cannot fail" (§6) is an engineering claim, not
 * a proof for every op, and a recovery mechanism is exactly the wrong place to bet the only
 * remaining good state on that claim holding for every frame, forever.
 */

export type SurfaceHost = {
  /** Currently active (visible) document — the object changes identity across a `commitSwap()`. */
  readonly document: Document;
  /**
   * Starts a resync build: attaches a fresh, invisible iframe (same bare-document stripping the
   * initial host gets) and returns its document. A stale, never-committed standby from a prior
   * abandoned build (should not normally happen — callers are expected to `discardBuild()` first)
   * is torn down before starting a new one, rather than leaking iframes.
   */
  beginResyncBuild(): Document;
  /**
   * Promotes the in-flight standby iframe to active and removes the previous active iframe.
   * Throws if `beginResyncBuild()` was never called (or its build was already committed/discarded)
   * — a programmer error, not a runtime condition callers should treat as recoverable.
   */
  commitSwap(): Document;
  /** Drops the in-flight standby iframe without swapping. No-op if there is no build in progress. */
  discardBuild(): void;
  /** Tear down iframes and attach a fresh bare document (lab Clear / after Stop). */
  reset(): void;
};

function attachBareIframe(container: HTMLElement): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.title = 'Projected surface';
  iframe.sandbox.add('allow-same-origin');
  iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff';
  container.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) throw new Error('surface: no contentDocument');
  // Strip the default about:blank html/head/body so id `1` (Document, frame-protocol.md §1.2)
  // starts from a bare document — exactly the state the producer's `document` was in when its
  // observer attached.
  while (doc.firstChild) doc.removeChild(doc.firstChild);

  return iframe;
}

function docOf(iframe: HTMLIFrameElement): Document {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('surface: no contentDocument');
  return doc;
}

export function createSurfaceHost(
  container: HTMLElement,
  opts: { width: number; height: number } = { width: 1280, height: 720 },
): SurfaceHost {
  container.style.position = 'relative';
  container.style.width = `${opts.width}px`;
  container.style.height = `${opts.height}px`;
  container.style.overflow = 'hidden';
  container.replaceChildren();

  let activeIframe = attachBareIframe(container);
  let standbyIframe: HTMLIFrameElement | null = null;

  return {
    get document(): Document {
      return docOf(activeIframe);
    },
    beginResyncBuild(): Document {
      if (standbyIframe !== null) standbyIframe.remove();
      standbyIframe = attachBareIframe(container);
      standbyIframe.style.visibility = 'hidden';
      return docOf(standbyIframe);
    },
    commitSwap(): Document {
      const standby = standbyIframe;
      if (standby === null) {
        throw new Error('surface: commitSwap called with no resync build in progress');
      }
      standby.style.visibility = '';
      const old = activeIframe;
      activeIframe = standby;
      standbyIframe = null;
      old.remove();
      return docOf(activeIframe);
    },
    discardBuild(): void {
      if (standbyIframe === null) return;
      standbyIframe.remove();
      standbyIframe = null;
    },
    reset(): void {
      if (standbyIframe !== null) {
        standbyIframe.remove();
        standbyIframe = null;
      }
      container.replaceChildren();
      activeIframe = attachBareIframe(container);
    },
  };
}
