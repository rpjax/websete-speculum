/**
 * Double buffer for nested projected hosts — standby iframe is client-only (not in the
 * producer table). The table-owned host iframe stays in the DOM; visibility swaps on commit.
 */

export type NestedResyncSurface = {
  readonly document: Document;
  beginResyncBuild(): Document;
  commitSwap(): Document;
  discardBuild(): void;
  /** Tear down client-only iframes; restore visibility on the table-owned host. */
  reset(): void;
};

import { attachProjectedNativeGuard } from './input/projectedNativeGuard';

function stripBareDocument(doc: Document): void {
  while (doc.firstChild) doc.removeChild(doc.firstChild);
  attachProjectedNativeGuard(doc);
}

function docOf(iframe: HTMLIFrameElement): Document {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('nested surface: no contentDocument');
  return doc;
}

export function createNestedResyncSurface(primaryHost: HTMLIFrameElement): NestedResyncSurface {
  const primaryDoc = primaryHost.contentDocument;
  if (primaryDoc) attachProjectedNativeGuard(primaryDoc);

  let activeIframe: HTMLIFrameElement = primaryHost;
  let standbyIframe: HTMLIFrameElement | null = null;

  function attachStandbySibling(): HTMLIFrameElement {
    const parent = activeIframe.parentElement;
    if (!parent) throw new Error('nested surface: host has no parent');
    const iframe = document.createElement('iframe');
    iframe.title = 'Nested projected resync build';
    iframe.sandbox.add('allow-same-origin');
    iframe.style.cssText = activeIframe.style.cssText;
    iframe.style.visibility = 'hidden';
    parent.insertBefore(iframe, activeIframe.nextSibling);
    stripBareDocument(docOf(iframe));
    return iframe;
  }

  return {
    get document(): Document {
      return docOf(activeIframe);
    },
    beginResyncBuild(): Document {
      if (standbyIframe !== null) standbyIframe.remove();
      standbyIframe = attachStandbySibling();
      return docOf(standbyIframe);
    },
    commitSwap(): Document {
      const built = standbyIframe;
      if (built === null) throw new Error('nested surface: commitSwap with no resync build');
      const outgoing = activeIframe;
      outgoing.style.visibility = 'hidden';
      built.style.visibility = '';
      activeIframe = built;
      standbyIframe = null;
      if (outgoing !== primaryHost) outgoing.remove();
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
      if (activeIframe !== primaryHost) {
        activeIframe.remove();
        activeIframe = primaryHost;
      }
      stripBareDocument(docOf(activeIframe));
      activeIframe.style.visibility = '';
    },
  };
}
