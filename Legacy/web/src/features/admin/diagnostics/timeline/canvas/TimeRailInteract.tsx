import { useCallback, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { TimeRail } from './TimeRail'

interface TimeRailInteractProps {
  startMs: number
  endMs: number
  width: number
  playheadMs?: number | null
  /** Zoom factor >1 zooms in. Anchor is ms under cursor when provided. */
  onZoom: (factor: number, anchorMs: number) => void
  /** Positive deltaMs pans the window later. */
  onPan: (deltaMs: number) => void
  children?: ReactNode
}

/**
 * Interactive wrapper around TimeRail: wheel zoom + horizontal drag pan.
 * Updates view domain only — never applies CSS transforms to the narrative.
 */
export function TimeRailInteract({
  startMs,
  endMs,
  width,
  playheadMs,
  onZoom,
  onPan,
}: TimeRailInteractProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ lastX: number; pointerId: number } | null>(null)

  const xToMs = useCallback(
    (clientX: number) => {
      const el = ref.current
      if (!el || width <= 0) return (startMs + endMs) / 2
      const rect = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(width, clientX - rect.left))
      const t = x / width
      return startMs + t * (endMs - startMs)
    },
    [startMs, endMs, width],
  )

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15
      onZoom(factor, xToMs(e.clientX))
    },
    [onZoom, xToMs],
  )

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { lastX: e.clientX, pointerId: e.pointerId }
    setDragging(true)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const dx = e.clientX - drag.lastX
      drag.lastX = e.clientX
      if (dx === 0 || width <= 0) return
      const span = endMs - startMs
      // Drag right → look earlier (content follows finger)
      onPan((-dx / width) * span)
    },
    [endMs, startMs, width, onPan],
  )

  const endDrag = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    dragRef.current = null
    setDragging(false)
  }, [])

  return (
    <div
      ref={ref}
      className={cn(
        'relative select-none touch-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
      style={{ width, height: 28 }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="presentation"
      aria-hidden
    >
      <TimeRail startMs={startMs} endMs={endMs} width={width} playheadMs={playheadMs} />
    </div>
  )
}
