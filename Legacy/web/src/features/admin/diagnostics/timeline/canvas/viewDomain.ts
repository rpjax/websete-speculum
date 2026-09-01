/** Pure view-domain helpers for narrative timeline pan/zoom (no CSS transforms). */

export interface ViewDomain {
  fromMs: number
  toMs: number
}

const MIN_SPAN_MS = 1_000

export function clampView(view: ViewDomain, dataFrom: number, dataTo: number): ViewDomain {
  const dataSpan = Math.max(1, dataTo - dataFrom)
  let span = Math.max(MIN_SPAN_MS, view.toMs - view.fromMs)
  span = Math.min(span, dataSpan)
  let mid = (view.fromMs + view.toMs) / 2
  const half = span / 2
  mid = Math.min(Math.max(mid, dataFrom + half), dataTo - half)
  return { fromMs: mid - half, toMs: mid + half }
}

export function zoomView(
  view: ViewDomain,
  factor: number,
  dataFrom: number,
  dataTo: number,
  anchorMs?: number,
): ViewDomain {
  const span = view.toMs - view.fromMs
  const nextSpan = Math.max(MIN_SPAN_MS, span / factor)
  const center = anchorMs ?? (view.fromMs + view.toMs) / 2
  return clampView(
    { fromMs: center - nextSpan / 2, toMs: center + nextSpan / 2 },
    dataFrom,
    dataTo,
  )
}

export function panView(
  view: ViewDomain,
  deltaMs: number,
  dataFrom: number,
  dataTo: number,
): ViewDomain {
  return clampView(
    { fromMs: view.fromMs + deltaMs, toMs: view.toMs + deltaMs },
    dataFrom,
    dataTo,
  )
}

export function jumpView(
  view: ViewDomain,
  ms: number,
  dataFrom: number,
  dataTo: number,
): ViewDomain {
  const span = view.toMs - view.fromMs
  return clampView({ fromMs: ms - span / 2, toMs: ms + span / 2 }, dataFrom, dataTo)
}

export function fitViewToChapters(
  chapters: { startMs: number; endMs: number }[],
  dataFrom: number,
  dataTo: number,
): ViewDomain {
  if (chapters.length === 0) {
    return clampView({ fromMs: dataFrom, toMs: dataTo }, dataFrom, dataTo)
  }
  const min = Math.min(...chapters.map((c) => c.startMs))
  const max = Math.max(...chapters.map((c) => c.endMs))
  const pad = Math.max(5_000, (max - min) * 0.08)
  return clampView({ fromMs: min - pad, toMs: max + pad }, dataFrom, dataTo)
}

/** Clamp a bar so left≥0 and left+width ≤ trackWidth. */
export function clampBar(
  left: number,
  width: number,
  trackWidth: number,
): { left: number; width: number } {
  if (trackWidth <= 0) return { left: 0, width: 0 }
  const w = Math.max(0, Math.min(width, trackWidth))
  const l = Math.max(0, Math.min(left, trackWidth - w))
  return { left: l, width: Math.max(0, Math.min(w, trackWidth - l)) }
}
