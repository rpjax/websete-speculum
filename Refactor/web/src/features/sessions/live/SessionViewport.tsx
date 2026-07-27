import { useCallback, useEffect, useRef } from 'react'
import type { ResizeSessionResult, SessionFrame, SessionInput } from '@/lib/speculum'
import { cn } from '@/lib/utils'
import {
  CanvasViewportSync,
  measureCanvasElement,
  type CanvasSize,
} from './CanvasViewportSync'
import { SessionInputController } from './SessionInputController'

export interface SessionViewportProps {
  /**
   * Confirmed remote session viewport (bitmap / hit-test space).
   * Must never drive CSS layout — the host box from CSS is authoritative.
   */
  width: number
  height: number
  live: boolean
  attachFrameSink: (sink: (frame: SessionFrame) => void) => () => void
  onInput: (input: SessionInput) => void
  /**
   * When set, observes the layout host and requests remote resize 1:1 with
   * the CSS box. Source is always the host — not window/screen, not the bitmap.
   */
  requestRemoteResize?: (
    size: CanvasSize,
    device: import('@/lib/speculum').SessionDeviceProfile,
  ) => Promise<ResizeSessionResult>
  /** Notifies parent of current CSS layout size (for StartSession measure). */
  onCanvasLayout?: (size: CanvasSize) => void
  /** Confirmed applied size after remote resize ack. */
  onRemoteViewportApplied?: (size: CanvasSize) => void
  /** Touch-primary session — suppress hover mouse, pen→touch. */
  touchPrimary?: boolean
  /** Remote editable focused — IME shell claims keyboard. */
  editingActive?: boolean
  /**
   * Increments on each OS-keyboard request (touch-primary). A boolean stays
   * stuck `true` after dismiss and blocks re-focus — nonce always re-runs focus.
   */
  keyboardNonce?: number
  className?: string
  /** Accessible name for the stream surface. */
  label?: string
}

/**
 * Session frame surface: CSS host owns layout; remote session adapts to that box.
 * Canvas is out-of-flow (`absolute`) so bitmap width/height never inflate the UI.
 * Input maps CSS box → remote frame (object-fill 1:1 after sync).
 */
export function SessionViewport({
  width,
  height,
  live,
  attachFrameSink,
  onInput,
  requestRemoteResize,
  onCanvasLayout,
  onRemoteViewportApplied,
  touchPrimary = false,
  editingActive = false,
  keyboardNonce = 0,
  className,
  label = 'Session frame stream',
}: SessionViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imeRef = useRef<HTMLTextAreaElement | null>(null)
  const contextRef = useRef<CanvasRenderingContext2D | null>(null)
  const decodingRef = useRef(false)
  const pendingRef = useRef<Uint8Array | null>(null)
  const frameSizeRef = useRef({ width, height })
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput
  const touchPrimaryRef = useRef(touchPrimary)
  touchPrimaryRef.current = touchPrimary
  const liveRef = useRef(live)
  liveRef.current = live
  const editingActiveRef = useRef(editingActive)
  editingActiveRef.current = editingActive
  const requestRemoteResizeRef = useRef(requestRemoteResize)
  requestRemoteResizeRef.current = requestRemoteResize
  const onCanvasLayoutRef = useRef(onCanvasLayout)
  onCanvasLayoutRef.current = onCanvasLayout
  const onRemoteViewportAppliedRef = useRef(onRemoteViewportApplied)
  onRemoteViewportAppliedRef.current = onRemoteViewportApplied
  const controllerRef = useRef<SessionInputController | null>(null)
  const syncRef = useRef<CanvasViewportSync | null>(null)
  const wasEditingRef = useRef(false)
  const mountedRef = useRef(true)

  const applyBufferSize = useCallback((w: number, h: number) => {
    const canvas = canvasRef.current
    if (!canvas || w <= 0 || h <= 0) {
      return
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }, [])

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
    if (!mountedRef.current || canvasRef.current !== canvas) {
      bitmap.close()
      return
    }
    // Buffer + input space follow confirmed remote viewport — not JPEG dimensions
    // (those lag after ResizeApplied and would desync hit-testing).
    const targetW = frameSizeRef.current.width
    const targetH = frameSizeRef.current.height
    if (targetW > 0 && targetH > 0) {
      applyBufferSize(targetW, targetH)
      context.drawImage(bitmap, 0, 0, targetW, targetH)
    }
    bitmap.close()
  }, [applyBufferSize])

  useEffect(() => {
    frameSizeRef.current = { width, height }
    controllerRef.current?.setFrameSize(width, height)
    applyBufferSize(width, height)
    controllerRef.current?.invalidateRect()
  }, [width, height, applyBufferSize])

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

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) {
      return
    }

    mountedRef.current = true
    const controller = new SessionInputController({
      getFrameSize: () => frameSizeRef.current,
      onInput: (input) => onInputRef.current(input),
      isTouchPrimary: () => touchPrimaryRef.current,
    })
    controllerRef.current = controller
    controller.bind(canvas, imeRef.current)
    controller.setEnabled(liveRef.current)

    const reportLayout = () => {
      const size = measureCanvasElement(host)
      onCanvasLayoutRef.current?.(size)
    }
    reportLayout()

    const onWindowResize = () => {
      controller.invalidateRect()
      reportLayout()
    }
    window.addEventListener('resize', onWindowResize)
    window.visualViewport?.addEventListener('resize', onWindowResize)
    window.visualViewport?.addEventListener('scroll', onWindowResize)

    return () => {
      mountedRef.current = false
      window.removeEventListener('resize', onWindowResize)
      window.visualViewport?.removeEventListener('resize', onWindowResize)
      window.visualViewport?.removeEventListener('scroll', onWindowResize)
      controller.setEnabled(false)
      controller.unbind()
      controllerRef.current = null
    }
  }, [])

  // CSS host → remote viewport sync while live (canvas bitmap never drives layout).
  useEffect(() => {
    const host = hostRef.current
    const request = requestRemoteResizeRef.current
    if (!host || !live || !request) {
      syncRef.current?.dispose()
      syncRef.current = null
      return
    }

    const isDeferred = () => editingActiveRef.current && touchPrimaryRef.current
    const sync = new CanvasViewportSync({
      measure: () => measureCanvasElement(host),
      resize: (size, device) => request(size, device),
      isDeferred,
      onApplied: (size) => {
        frameSizeRef.current = size
        applyBufferSize(size.width, size.height)
        controllerRef.current?.setFrameSize(size.width, size.height)
        controllerRef.current?.invalidateRect()
        onRemoteViewportAppliedRef.current?.(size)
      },
    })
    // Seed with last known remote; observer + measure immediately correct to CSS box.
    sync.seedRemote(width, height)
    sync.observe(host)
    const layout = measureCanvasElement(host)
    if (layout.width >= 100 && layout.height >= 100) {
      sync.schedule(layout.width, layout.height)
    }
    syncRef.current = sync

    return () => {
      sync.dispose()
      if (syncRef.current === sync) {
        syncRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-bind when live toggles
  }, [live, applyBufferSize])

  // Flush when deferral clears (IME closed OR no longer touch-primary).
  useEffect(() => {
    const deferred = editingActive && touchPrimary
    if (!deferred) {
      syncRef.current?.flushPending()
    }
  }, [editingActive, touchPrimary])

  useEffect(() => {
    controllerRef.current?.setEnabled(live)
  }, [live])

  useEffect(() => {
    if (!live) {
      controllerRef.current?.blurIme()
      wasEditingRef.current = false
      return
    }
    if (editingActive) {
      wasEditingRef.current = true
      controllerRef.current?.focusIme()
      return
    }
    if (wasEditingRef.current) {
      wasEditingRef.current = false
      controllerRef.current?.blurIme()
      canvasRef.current?.focus({ preventScroll: true })
    }
  }, [live, editingActive])

  useEffect(() => {
    if (!live || keyboardNonce === 0) {
      return
    }
    controllerRef.current?.focusIme()
  }, [live, keyboardNonce])

  return (
    <div
      ref={hostRef}
      className={cn('relative h-full min-h-0 min-w-0 w-full overflow-hidden', className)}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={label}
        className={cn(
          // Out of flow + min-size 0: bitmap attrs never inflate the CSS host.
          'absolute inset-0 block h-full w-full min-h-0 min-w-0 touch-none bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring',
          live ? 'cursor-crosshair' : 'cursor-not-allowed opacity-60',
        )}
        style={{ touchAction: 'none' }}
      />
      <textarea
        ref={imeRef}
        aria-hidden
        tabIndex={-1}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        className="pointer-events-none absolute h-px w-px opacity-0"
        style={{ left: 0, top: 0, caretColor: 'transparent' }}
      />
    </div>
  )
}
