/**
 * Double buffer for nested projected hosts — standby iframe is client-only (not in the
 * producer table). The table-owned host iframe stays in the DOM; visibility swaps on commit.
 *
 * Standby birth matches root surface: {@link stampProjectedStandardsSrcdoc} before insert,
 * then {@link whenProjectedStandardsReady}. No `document.open`/`write`.
 */

export type NestedResyncSurface = {
  readonly document: Document;
  beginResyncBuild(): Promise<Document>;
  commitSwap(): Document;
  discardBuild(): void;
  /** Tear down client-only iframes; restore visibility on the table-owned host. */
  reset(): Promise<void>;
};

import { attachProjectedNativeGuard } from './input/projectedNativeGuard';
import {
  isProjectedStandardsSkeleton,
  stampProjectedStandardsSrcdoc,
  stripProjectedSkeleton,
  whenProjectedStandardsReady,
} from './projectedBlankIframe';

function docOf(iframe: HTMLIFrameElement): Document {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('nested surface: no contentDocument');
  return doc;
}

async function reseedHostDocument(iframe: HTMLIFrameElement): Promise<Document> {
  const live = iframe.contentDocument;
  if (isProjectedStandardsSkeleton(live)) {
    stripProjectedSkeleton(live);
    attachProjectedNativeGuard(live);
    return live;
  }
  stampProjectedStandardsSrcdoc(iframe);
  const doc = await whenProjectedStandardsReady(iframe);
  attachProjectedNativeGuard(doc);
  return doc;
}

export function createNestedResyncSurface(primaryHost: HTMLIFrameElement): NestedResyncSurface {
  const primaryDoc = primaryHost.contentDocument;
  if (primaryDoc) attachProjectedNativeGuard(primaryDoc);

  let activeIframe: HTMLIFrameElement = primaryHost;
  let standbyIframe: HTMLIFrameElement | null = null;

  async function attachStandbySibling(): Promise<HTMLIFrameElement> {
    const parent = activeIframe.parentElement;
    if (!parent) throw new Error('nested surface: host has no parent');
    const iframe = document.createElement('iframe');
    iframe.title = 'Nested projected resync build';
    iframe.sandbox.add('allow-same-origin');
    iframe.style.cssText = activeIframe.style.cssText;
    iframe.style.visibility = 'hidden';
    stampProjectedStandardsSrcdoc(iframe);
    parent.insertBefore(iframe, activeIframe.nextSibling);
    const doc = await whenProjectedStandardsReady(iframe);
    attachProjectedNativeGuard(doc);
    return iframe;
  }

  return {
    get document(): Document {
      return docOf(activeIframe);
    },
    async beginResyncBuild(): Promise<Document> {
      if (standbyIframe !== null) standbyIframe.remove();
      standbyIframe = await attachStandbySibling();
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
    async reset(): Promise<void> {
      if (standbyIframe !== null) {
        standbyIframe.remove();
        standbyIframe = null;
      }
      if (activeIframe !== primaryHost) {
        activeIframe.remove();
        activeIframe = primaryHost;
      }
      await reseedHostDocument(activeIframe);
      activeIframe.style.visibility = '';
    },
  };
}
