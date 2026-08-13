/**
 * Vanilla double-buffer surface for lab (DOM-only: cssom auto-ready).
 */

export type SurfaceBuildHandle = {
  readonly document: Document;
  writeChunk(html: string): void;
  markEstablishEnd(): void;
  markCssomReady(): void;
  swap(): Promise<Document>;
  cancel(): void;
};

export type SurfaceHost = {
  getActiveDocument(): Document | null;
  isArmed(): boolean;
  beginBuild(): SurfaceBuildHandle;
};

const SURFACE_SANDBOX = 'allow-same-origin';

export function createSurfaceHost(
  container: HTMLElement,
  opts: { width: number; height: number; swapTimeoutMs?: number } = {
    width: 1280,
    height: 720,
  },
): SurfaceHost {
  const swapTimeoutMs = opts.swapTimeoutMs ?? 1500;
  container.style.position = 'relative';
  container.style.width = `${opts.width}px`;
  container.style.height = `${opts.height}px`;
  container.style.overflow = 'hidden';
  container.replaceChildren();

  const makeFrame = (title: string) => {
    const iframe = document.createElement('iframe');
    iframe.title = title;
    iframe.sandbox.add('allow-same-origin');
    iframe.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;border:0;visibility:hidden';
    container.appendChild(iframe);
    return iframe;
  };

  const frameA = makeFrame('Projected surface (A)');
  const frameB = makeFrame('Projected surface (B)');
  let active: 'a' | 'b' | null = null;

  const frameOf = (slot: 'a' | 'b') => (slot === 'a' ? frameA : frameB);

  return {
    getActiveDocument: () => {
      if (!active) return null;
      return frameOf(active).contentDocument;
    },
    isArmed: () => active !== null,
    beginBuild: () => {
      const standby: 'a' | 'b' = active === 'a' ? 'b' : 'a';
      const frame = frameOf(standby);
      return buildInto(frame, swapTimeoutMs, () => {
        frameOf(standby).style.visibility = 'visible';
        if (active) frameOf(active).style.visibility = 'hidden';
        active = standby;
      });
    },
  };
}

function buildInto(
  frame: HTMLIFrameElement,
  swapTimeoutMs: number,
  doSwap: () => void,
): SurfaceBuildHandle {
  const initial = frame.contentDocument;
  if (!initial) throw new Error('surface: no contentDocument');
  initial.open();

  const currentDoc = (): Document => {
    const doc = frame.contentDocument;
    if (!doc) throw new Error('surface: lost contentDocument');
    return doc;
  };

  let cancelled = false;
  let swapped = false;
  let establishEnded = false;
  let cssomReady = false;
  let timeoutId: number | null = null;
  let resolveSwap: (doc: Document) => void = () => {};
  const swapPromise = new Promise<Document>((resolve) => {
    resolveSwap = resolve;
  });

  function clearForceTimer(): void {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function armForceTimer(): void {
    if (timeoutId != null || swapped || cancelled) return;
    if (!(establishEnded && cssomReady)) return;
    timeoutId = window.setTimeout(() => attemptSwap(true), swapTimeoutMs);
  }

  function attemptSwap(force: boolean): void {
    if (swapped || cancelled) return;
    const doc = currentDoc();
    if (!(establishEnded && cssomReady)) return;
    if (!force) {
      const body = doc.body;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
    }
    swapped = true;
    clearForceTimer();
    doSwap();
    resolveSwap(doc);
  }

  // DOM-only seal: no cssomInstall — mark ready immediately.
  cssomReady = true;

  return {
    get document() {
      return currentDoc();
    },
    writeChunk(html: string) {
      if (cancelled || establishEnded) return;
      currentDoc().write(html);
      attemptSwap(false);
    },
    markEstablishEnd() {
      if (cancelled) return;
      if (!establishEnded) {
        establishEnded = true;
        try {
          currentDoc().close();
        } catch {
          /* */
        }
      }
      armForceTimer();
      attemptSwap(false);
    },
    markCssomReady() {
      if (cancelled) return;
      cssomReady = true;
      armForceTimer();
      attemptSwap(false);
    },
    swap: () => swapPromise,
    cancel() {
      cancelled = true;
      clearForceTimer();
    },
  };
}

void SURFACE_SANDBOX;
