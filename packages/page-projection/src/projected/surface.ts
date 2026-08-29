/**
 * Projected surface — real double buffer (Stage 4, frame-protocol §5.8).
 *
 * Host model (viewport lockstep): the **outer** `container` stays fluid (100% of the measure
 * host). An inner **stage** holds fixed CSS px matching the confirmed Virtual viewport.
 * ResizeObserver must observe the fluid outer host, never this stage.
 *
 * Blank iframes boot via {@link stampProjectedStandardsSrcdoc} **before** insert (K4).
 * Do not reintroduce quirks-mode margin hacks or `document.open`/`write`.
 */

import {
  stampProjectedStandardsSrcdoc,
  whenProjectedStandardsReady,
} from './projectedBlankIframe';

export type SurfaceHost = {
  /** Currently active (visible) document — the object changes identity across a `commitSwap()`. */
  readonly document: Document;
  beginResyncBuild(): Promise<Document>;
  commitSwap(): Document;
  discardBuild(): void;
  reset(): Promise<void>;
  setCssSize(width: number, height: number): void;
  getCssSize(): { width: number; height: number };
};

async function attachBareIframe(container: HTMLElement): Promise<HTMLIFrameElement> {
  const iframe = document.createElement('iframe');
  iframe.title = 'Projected surface';
  iframe.sandbox.add('allow-same-origin');
  iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff';
  // K4: first navigation is standards — never touch about:blank's BackCompat document.
  stampProjectedStandardsSrcdoc(iframe);
  container.appendChild(iframe);
  await whenProjectedStandardsReady(iframe);
  return iframe;
}

function docOf(iframe: HTMLIFrameElement): Document {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('surface: no contentDocument');
  return doc;
}

export async function createSurfaceHost(
  container: HTMLElement,
  opts: { width: number; height: number } = { width: 1280, height: 720 },
): Promise<SurfaceHost> {
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

  let activeIframe = await attachBareIframe(stage);
  let standbyIframe: HTMLIFrameElement | null = null;

  return {
    get document(): Document {
      return docOf(activeIframe);
    },
    async beginResyncBuild(): Promise<Document> {
      if (standbyIframe !== null) standbyIframe.remove();
      standbyIframe = await attachBareIframe(stage);
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
    async reset(): Promise<void> {
      if (standbyIframe !== null) {
        standbyIframe.remove();
        standbyIframe = null;
      }
      stage.replaceChildren();
      activeIframe = await attachBareIframe(stage);
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
