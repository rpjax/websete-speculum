/**
 * v0 lab surface — single iframe, no double buffering. Cold start is an ordinary frame
 * stream applied directly (frame-protocol.md §4.7: "establish does not exist"), not a
 * separate build-then-swap phase, so there is nothing to double-buffer yet. Resync's
 * double-buffer swap (§5.8, contracts/08-surface.md) is out of scope for this increment —
 * pinned, see HANDOFF.md.
 */

export type SurfaceHost = {
  readonly document: Document;
};

export function createSurfaceHost(
  container: HTMLElement,
  opts: { width: number; height: number } = { width: 1280, height: 720 },
): SurfaceHost {
  container.style.position = 'relative';
  container.style.width = `${opts.width}px`;
  container.style.height = `${opts.height}px`;
  container.style.overflow = 'hidden';
  container.replaceChildren();

  const iframe = document.createElement('iframe');
  iframe.title = 'Projected surface';
  iframe.sandbox.add('allow-same-origin');
  iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
  container.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) throw new Error('surface: no contentDocument');

  // Strip the default about:blank html/head/body so id `1` (Document, frame-protocol.md
  // §1.2) starts from a bare document — exactly the state the producer's `document` was
  // in when its observer attached.
  while (doc.firstChild) doc.removeChild(doc.firstChild);

  return { document: doc };
}
