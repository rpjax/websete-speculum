/**
 * Virtual scroll SET from range fractions (scrollFracX/Y).
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

/** Map fraction of range → CSS px. Range zero → 0 (no position to set). */
export function scrollPxFromFrac(frac: number, range: number): number {
  return range === 0 ? 0 : frac * range;
}

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
    const rangeY = se ? se.scrollHeight - se.clientHeight : 0;
    const rangeX = se ? se.scrollWidth - se.clientWidth : 0;
    const top = scrollPxFromFrac(entry.scrollFracY, rangeY);
    const left = scrollPxFromFrac(entry.scrollFracX, rangeX);
    const mark = { viewport: { top, left } };
    note?.(mark);
    if (se) {
      se.scrollTop = top;
      se.scrollLeft = left;
    } else {
      doc.defaultView?.scrollTo(left, top);
    }
    consume?.(mark);
    return;
  }
  const el = domNodes.get(entry.nodeId);
  if (!el || el.nodeType !== 1) {
    missing.push(entry.nodeId);
    return;
  }
  const node = el as unknown as {
    scrollTop: number;
    scrollLeft: number;
    scrollHeight: number;
    scrollWidth: number;
    clientHeight: number;
    clientWidth: number;
  };
  const rangeY = node.scrollHeight - node.clientHeight;
  const rangeX = node.scrollWidth - node.clientWidth;
  const top = scrollPxFromFrac(entry.scrollFracY, rangeY);
  const left = scrollPxFromFrac(entry.scrollFracX, rangeX);
  const mark = { element: { nodeId: entry.nodeId, top, left } };
  note?.(mark);
  node.scrollTop = top;
  node.scrollLeft = left;
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
