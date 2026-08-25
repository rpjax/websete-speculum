/**
 * Projected surface — real double buffer (Stage 4, frame-protocol §5.8).
 *
 * Host model (viewport lockstep): the **outer** `container` stays fluid (100% of the measure
 * host). An inner **stage** holds fixed CSS px matching the confirmed Virtual viewport.
 * ResizeObserver must observe the fluid outer host, never this stage.
 */

export type SurfaceHost = {
  /** Currently active (visible) document — the object changes identity across a `commitSwap()`. */
  readonly document: Document;
  beginResyncBuild(): Document;
  commitSwap(): Document;
  discardBuild(): void;
  reset(): void;
  setCssSize(width: number, height: number): void;
  getCssSize(): { width: number; height: number };
};

function attachBareIframe(container: HTMLElement): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.title = 'Projected surface';
  iframe.sandbox.add('allow-same-origin');
  iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff';
  container.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) throw new Error('surface: no contentDocument');
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
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.replaceChildren();

  const stage = document.createElement('div');
  stage.setAttribute('data-pp-surface-stage', '');
  let cssW = Math.max(1, Math.round(opts.width));
  let cssH = Math.max(1, Math.round(opts.height));
  stage.style.cssText =
    `position:absolute;left:0;top:0;overflow:hidden;width:${cssW}px;height:${cssH}px`;
  container.appendChild(stage);

  let activeIframe = attachBareIframe(stage);
  let standbyIframe: HTMLIFrameElement | null = null;

  return {
    get document(): Document {
      return docOf(activeIframe);
    },
    beginResyncBuild(): Document {
      if (standbyIframe !== null) standbyIframe.remove();
      standbyIframe = attachBareIframe(stage);
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
      stage.replaceChildren();
      activeIframe = attachBareIframe(stage);
    },
    setCssSize(width: number, height: number): void {
      cssW = Math.max(1, Math.round(width));
      cssH = Math.max(1, Math.round(height));
      stage.style.width = `${cssW}px`;
      stage.style.height = `${cssH}px`;
    },
    getCssSize(): { width: number; height: number } {
      return { width: cssW, height: cssH };
    },
  };
}
