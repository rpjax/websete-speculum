import { useCallback, useEffect, useRef } from 'react'
import type { ResizeSessionResult, SessionFrame, SessionInput } from '@/lib/speculum'
import { cn } from '@/lib/utils'
import {
  CanvasViewportSync,
  measureCanvasElement,
  viewportSizesClose,
  type CanvasSize,
} from './CanvasViewportSync'
import { SessionInputController } from './SessionInputController'
import { computeScreencastEncodeSize } from './screencastEncode'

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
  /** Sessions.ViewportPolicy from StartSession — required when requestRemoteResize is set. */
  viewportPolicy?: import('@/features/motor/live/deviceProfile').SessionViewportBounds
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
  /** Client devicePixelRatio (already clamped by detectDeviceProfile). */
  deviceScaleFactor?: number
  /** Sessions.ScreencastPolicy.MaxEncodeScale from client-config (1..2). */
  maxEncodeScale?: number
  /**
   * `immersive` — end-user live catch-all (no session chrome tells).
   * `lab` — operator lab surface (muted boot, crosshair, opacity when idle).
   */
  presentation?: 'immersive' | 'lab'
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
  viewportPolicy,
  onCanvasLayout,
  onRemoteViewportApplied,
  touchPrimary = false,
  editingActive = false,
  keyboardNonce = 0,
  deviceScaleFactor = 1,
  maxEncodeScale = 2,
  presentation = 'lab',
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

  const resolveEncodeSize = useCallback(
    (cssW: number, cssH: number) =>
      computeScreencastEncodeSize({
        cssWidth: cssW,
        cssHeight: cssH,
        deviceScaleFactor,
        displayWidth: viewportPolicy?.maxWidth ?? cssW,
        displayHeight: viewportPolicy?.maxHeight ?? cssH,
        maxEncodeScale,
      }),
    [deviceScaleFactor, maxEncodeScale, viewportPolicy?.maxWidth, viewportPolicy?.maxHeight],
  )

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
    // Hit-test / input stay on confirmed remote CSS viewport.
    // Buffer follows the JPEG pixels Chrome actually sent (CSS or encode).
    const cssW = frameSizeRef.current.width
    const cssH = frameSizeRef.current.height
    if (cssW > 0 && cssH > 0) {
      const encode = resolveEncodeSize(cssW, cssH)
      const bufW = bitmap.width > 0 ? bitmap.width : encode.width
      const bufH = bitmap.height > 0 ? bitmap.height : encode.height
      applyBufferSize(bufW, bufH)
      context.imageSmoothingEnabled = false
      context.drawImage(bitmap, 0, 0, bufW, bufH)
    }
    bitmap.close()
  }, [applyBufferSize, resolveEncodeSize])

  useEffect(() => {
    frameSizeRef.current = { width, height }
    controllerRef.current?.setFrameSize(width, height)
    if (width > 0 && height > 0) {
      const encode = resolveEncodeSize(width, height)
      applyBufferSize(encode.width, encode.height)
    }
    controllerRef.current?.invalidateRect()
  }, [width, height, applyBufferSize, resolveEncodeSize])

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

    // Keep StartSession informed of CSS box size even before live (no remote resize).
    const layoutObserver = new ResizeObserver(() => {
      controller.invalidateRect()
      reportLayout()
    })
    layoutObserver.observe(host)

    const onWindowResize = () => {
      controller.invalidateRect()
      reportLayout()
    }
    window.addEventListener('resize', onWindowResize)
    window.visualViewport?.addEventListener('resize', onWindowResize)
    window.visualViewport?.addEventListener('scroll', onWindowResize)

    return () => {
      mountedRef.current = false
      layoutObserver.disconnect()
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
    if (!host || !live || !request || !viewportPolicy) {
      syncRef.current?.dispose()
      syncRef.current = null
      return
    }

    const isDeferred = () => editingActiveRef.current && touchPrimaryRef.current
    const sync = new CanvasViewportSync({
      measure: () => measureCanvasElement(host),
      resize: (size, device) => request(size, device),
      viewportPolicy,
      isDeferred,
      onApplied: (size) => {
        // Hit-test / paint buffer follow CSS-requested remote size — never inflate CSS.
        frameSizeRef.current = size
        applyBufferSize(size.width, size.height)
        controllerRef.current?.setFrameSize(size.width, size.height)
        controllerRef.current?.invalidateRect()
        onRemoteViewportAppliedRef.current?.(size)
      },
    })
    // Seed with StartSession size (props). Only ResizeAsync when client surface differs.
    const layout = measureCanvasElement(host)
    sync.seedRemote(width, height)
    sync.observe(host)
    if (
      layout.width >= viewportPolicy.minWidth
      && layout.height >= viewportPolicy.minHeight
      && !viewportSizesClose(layout.width, layout.height, width, height)
    ) {
      sync.schedule(layout.width, layout.height)
    }
    syncRef.current = sync

    return () => {
      sync.dispose()
      if (syncRef.current === sync) {
        syncRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-bind when live/policy toggles
  }, [live, applyBufferSize, viewportPolicy])

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
          // Out of flow + explicit max: bitmap attrs never inflate the CSS host.
          'absolute inset-0 block h-full w-full max-h-full max-w-full min-h-0 min-w-0 touch-none outline-none',
          presentation === 'immersive'
            ? 'cursor-default bg-white'
            : cn(
                'bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                live ? 'cursor-crosshair' : 'cursor-not-allowed opacity-60',
              ),
        )}
        style={{ touchAction: 'none', width: '100%', height: '100%' }}
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
