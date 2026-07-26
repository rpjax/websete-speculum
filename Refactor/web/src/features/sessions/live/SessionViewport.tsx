import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { SessionFrame, SessionInput, TouchPointInput } from '@/lib/speculum'
import { cn } from '@/lib/utils'
import { clientToFramePoint, normalizeWheelDeltas } from './sessionCoords'

export interface SessionViewportProps {
  width: number
  height: number
  live: boolean
  attachFrameSink: (sink: (frame: SessionFrame) => void) => () => void
  onInput: (input: SessionInput) => void
  className?: string
  /** Accessible name for the stream surface. */
  label?: string
}

type TouchPhase = 'start' | 'move' | 'end' | 'cancel'

/**
 * Shared session frame surface: paints JPEGs and forwards interactive input.
 * Used by both the immersive live page and the smoke/debug chrome.
 *
 * Coordinates account for CSS `object-contain` letterboxing. Mouse moves are
 * coalesced per animation frame, but the first move after a button press is
 * flushed immediately so clicks are not delayed behind rAF.
 */
export function SessionViewport({
  width,
  height,
  live,
  attachFrameSink,
  onInput,
  className,
  label = 'Session frame stream',
}: SessionViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const contextRef = useRef<CanvasRenderingContext2D | null>(null)
  const decodingRef = useRef(false)
  const pendingRef = useRef<Uint8Array | null>(null)
  const moveRef = useRef<{ x: number; y: number } | null>(null)
  const moveFrameRef = useRef<number | null>(null)
  const touchesRef = useRef(new Map<number, TouchPointInput>())
  const frameSizeRef = useRef({ width, height })

  const paint = useCallback(async (jpeg: Uint8Array) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    contextRef.current ??= canvas.getContext('2d')
    const context = contextRef.current
    if (!context) {
      return
    }
    const bitmap = await createImageBitmap(
      new Blob([jpeg as unknown as BlobPart], { type: 'image/jpeg' }),
    )
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      frameSizeRef.current = { width: bitmap.width, height: bitmap.height }
    }
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
  }, [])

  useEffect(() => {
    frameSizeRef.current = { width, height }
  }, [width, height])

  useEffect(() => {
    const pump = async (jpeg: Uint8Array): Promise<void> => {
      if (decodingRef.current) {
        pendingRef.current = jpeg
        return
      }
      decodingRef.current = true
      try {
        let next: Uint8Array | null = jpeg
        while (next) {
          await paint(next)
          next = pendingRef.current
          pendingRef.current = null
        }
      } finally {
        decodingRef.current = false
      }
    }

    return attachFrameSink((frame) => {
      if (frame.jpeg?.byteLength) {
        void pump(frame.jpeg)
      }
    })
  }, [attachFrameSink, paint])

  const toFramePoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return { x: 0, y: 0 }
    }
    const rect = canvas.getBoundingClientRect()
    const size = frameSizeRef.current
    return clientToFramePoint(clientX, clientY, rect, size.width, size.height)
  }, [])

  const flushMove = useCallback(() => {
    moveFrameRef.current = null
    const point = moveRef.current
    moveRef.current = null
    if (point) {
      onInput({ type: 'mousemove', x: point.x, y: point.y })
    }
  }, [onInput])

  const queueMove = useCallback(
    (clientX: number, clientY: number, immediate = false) => {
      moveRef.current = toFramePoint(clientX, clientY)
      if (immediate) {
        if (moveFrameRef.current != null) {
          window.cancelAnimationFrame(moveFrameRef.current)
          moveFrameRef.current = null
        }
        flushMove()
        return
      }
      moveFrameRef.current ??= window.requestAnimationFrame(flushMove)
    },
    [flushMove, toFramePoint],
  )

  const handleMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!live) {
        return
      }
      queueMove(event.clientX, event.clientY)
    },
    [live, queueMove],
  )

  useEffect(() => {
    return () => {
      if (moveFrameRef.current != null) {
        window.cancelAnimationFrame(moveFrameRef.current)
      }
    }
  }, [])

  const handleMouseButton = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>, type: 'mousedown' | 'mouseup') => {
      if (!live) {
        return
      }
      if (type === 'mousedown') {
        canvasRef.current?.focus()
        // Align cursor before the button so the remote hit-test matches.
        queueMove(event.clientX, event.clientY, true)
      }
      const { x, y } = toFramePoint(event.clientX, event.clientY)
      onInput({ type, x, y, button: event.button })
    },
    [live, onInput, queueMove, toFramePoint],
  )

  const handleKey = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>, type: 'keydown' | 'keyup') => {
      if (!live) {
        return
      }
      event.preventDefault()
      onInput({ type, key: event.key })
      const printable =
        type === 'keydown' &&
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      if (printable) {
        onInput({ type: 'type', text: event.key })
      }
    },
    [live, onInput],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const readPoints = (list: TouchList): TouchPointInput[] => {
      const points: TouchPointInput[] = []
      for (let index = 0; index < list.length; index++) {
        const touch = list.item(index)
        if (!touch) {
          continue
        }
        const { x, y } = toFramePoint(touch.clientX, touch.clientY)
        points.push({
          id: touch.identifier,
          x,
          y,
          radiusX: touch.radiusX || 1,
          radiusY: touch.radiusY || 1,
          force: touch.force || 1,
        })
      }
      return points
    }

    const onWheel = (event: WheelEvent): void => {
      if (!live) {
        return
      }
      event.preventDefault()
      const { x, y } = toFramePoint(event.clientX, event.clientY)
      const size = frameSizeRef.current
      const deltas = normalizeWheelDeltas(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        size.width,
        size.height,
      )
      onInput({ type: 'wheel', x, y, deltaX: deltas.deltaX, deltaY: deltas.deltaY })
    }

    const onTouch = (event: TouchEvent, phase: TouchPhase): void => {
      if (!live) {
        return
      }
      event.preventDefault()
      const changed = readPoints(event.changedTouches)
      const active = touchesRef.current
      if (phase === 'start' || phase === 'move') {
        for (const point of readPoints(event.touches)) {
          active.set(point.id, point)
        }
      } else {
        for (const point of changed) {
          active.delete(point.id)
        }
      }
      onInput({
        type: 'touch',
        phase,
        points: [...active.values()],
        changedIds: changed.map((point) => point.id),
      })
    }

    const listeners: Array<[string, (event: Event) => void]> = [
      ['wheel', (event) => onWheel(event as WheelEvent)],
      ['touchstart', (event) => onTouch(event as TouchEvent, 'start')],
      ['touchmove', (event) => onTouch(event as TouchEvent, 'move')],
      ['touchend', (event) => onTouch(event as TouchEvent, 'end')],
      ['touchcancel', (event) => onTouch(event as TouchEvent, 'cancel')],
    ]
    for (const [type, listener] of listeners) {
      canvas.addEventListener(type, listener, { passive: false })
    }
    return () => {
      for (const [type, listener] of listeners) {
        canvas.removeEventListener(type, listener)
      }
    }
  }, [live, onInput, toFramePoint])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      tabIndex={0}
      aria-label={label}
      className={cn(
        'h-full w-full bg-muted object-contain outline-none focus-visible:ring-2 focus-visible:ring-ring',
        live ? 'cursor-crosshair' : 'cursor-not-allowed opacity-60',
        className,
      )}
      onMouseMove={handleMouseMove}
      onMouseDown={(event) => handleMouseButton(event, 'mousedown')}
      onMouseUp={(event) => handleMouseButton(event, 'mouseup')}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => handleKey(event, 'keydown')}
      onKeyUp={(event) => handleKey(event, 'keyup')}
    />
  )
}
