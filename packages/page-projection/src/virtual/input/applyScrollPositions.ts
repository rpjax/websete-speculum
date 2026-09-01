/**
 * Virtual absolute scroll SET (§10.1b / D-UI-28 Phase A).
 * missingNodeIds alone do not fail the whole apply.
 */

import type { DomNodeTable } from '../dom/domNodeTable';
import type { ScrollPositionEntry } from '../../core/input/unifiedIntentTypes';

export type ApplyScrollPositionsResult = {
  ok: true;
  missingNodeIds: number[];
};

type ScrollEchoGlobals = {
  __speculumDomNoteScrollEcho?: (n: unknown) => void;
  __speculumDomConsumeScrollEchoIfAt?: (n: unknown) => boolean;
  top?: {
    __speculumDomNoteScrollEcho?: (n: unknown) => void;
    __speculumDomConsumeScrollEchoIfAt?: (n: unknown) => boolean;
  };
};

function scrollEchoApis(): {
  note?: (n: unknown) => void;
  consume?: (n: unknown) => boolean;
} {
  const g = globalThis as typeof globalThis & ScrollEchoGlobals;
  let note = g.__speculumDomNoteScrollEcho;
  let consume = g.__speculumDomConsumeScrollEchoIfAt;
  if (!note || !consume) {
    try {
      note = note ?? g.top?.__speculumDomNoteScrollEcho;
      consume = consume ?? g.top?.__speculumDomConsumeScrollEchoIfAt;
    } catch {
      /* cross-origin top */
    }
  }
  return { note, consume };
}

function applyOne(
  domNodes: DomNodeTable,
  doc: Document,
  entry: ScrollPositionEntry,
  missing: number[],
): void {
  const { note, consume } = scrollEchoApis();
  if (entry.nodeId == null) {
    const se = doc.scrollingElement as HTMLElement | null;
    const mark = { viewport: { top: entry.scrollY, left: entry.scrollX } };
    note?.(mark);
    if (se) {
      se.scrollTop = entry.scrollY;
      se.scrollLeft = entry.scrollX;
    } else {
      doc.defaultView?.scrollTo(entry.scrollX, entry.scrollY);
    }
    consume?.(mark);
    return;
  }
  const el = domNodes.get(entry.nodeId);
  if (!el || el.nodeType !== 1) {
    missing.push(entry.nodeId);
    return;
  }
  const node = el as unknown as { scrollTop: number; scrollLeft: number };
  const mark = { element: { nodeId: entry.nodeId, top: entry.scrollY, left: entry.scrollX } };
  note?.(mark);
  node.scrollTop = entry.scrollY;
  node.scrollLeft = entry.scrollX;
  consume?.(mark);
}

/** Apply scroll positions for one Virtual context document. */
export function applyScrollPositions(
  domNodes: DomNodeTable,
  doc: Document,
  positions: ScrollPositionEntry[],
): ApplyScrollPositionsResult {
  const missingNodeIds: number[] = [];
  for (const entry of positions) {
    applyOne(domNodes, doc, entry, missingNodeIds);
  }
  return { ok: true, missingNodeIds };
}
