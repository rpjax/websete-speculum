/**
 * Projected surface host — docs/page-projection-engine-redesign.md §5.8.
 *
 * Same-origin iframe, `sandbox` WITHOUT `allow-scripts` (K5 becomes
 * browser-enforced rather than dependent on a deny-list completeness).
 * `allow-same-origin` is the only token: it is required for the parent to
 * script into the iframe's own document; nothing else is granted, so native
 * anchor/form navigation of the sandboxed frame is blocked by the browser too.
 *
 * Double buffered: two iframes exist at all times. A new establish/resync
 * builds into the standby one while the current surface stays visible; the
 * swap happens at the first-meaningful-paint threshold — `establishEnd`
 * applied AND `cssomInstall` applied AND the body has a non-empty layout box —
 * or `swapTimeoutMs` elapses, whichever comes first (§5.8.5).
 */
import type { CSSProperties } from 'react'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

/** One in-flight establish/resync build targeting the standby buffer. */
export interface SurfaceBuildHandle {
  readonly document: Document
  /** Feeds one HTML chunk into the standby document's streaming parser (§5.6.4). */
  writeChunk(html: string): void
  /** `establishEnd` applied — closes the parser and re-checks the swap threshold. */
  markEstablishEnd(): void
  /** `cssomInstall` applied on the standby buffer. */
  markCssomReady(): void
  /** Resolves with the standby document once it swaps to active. */
  swap(): Promise<Document>
  /** Discards this build without swapping — superseded by a newer establish/resync. */
  cancel(): void
}

export interface SurfaceHostHandle {
  /** The visible buffer's document, or `null` before the first swap. */
  getActiveDocument(): Document | null
  /** True once at least one buffer has swapped to active. */
  isArmed(): boolean
  /** Opens the standby buffer's parser for a new establish/resync (§5.6, §5.7.2). */
  beginBuild(): SurfaceBuildHandle
}

export interface SurfaceHostProps {
  width: number
  height: number
  className?: string
  /** Default 1500 — §5.16 `swapTimeoutMs`. */
  swapTimeoutMs?: number
  onSwap?: (doc: Document) => void
}

const DEFAULT_SWAP_TIMEOUT_MS = 1500
/** `sandbox` grants only same-origin document access — never `allow-scripts` (K5). */
const SURFACE_SANDBOX = 'allow-same-origin'

export const SurfaceHost = forwardRef<SurfaceHostHandle, SurfaceHostProps>(function SurfaceHost(
  { width, height, className, swapTimeoutMs = DEFAULT_SWAP_TIMEOUT_MS, onSwap },
  ref,
) {
  const frameARef = useRef<HTMLIFrameElement>(null)
  const frameBRef = useRef<HTMLIFrameElement>(null)
  const [activeSlot, setActiveSlot] = useState<'a' | 'b' | null>(null)
  const activeSlotRef = useRef<'a' | 'b' | null>(null)
  activeSlotRef.current = activeSlot

  useImperativeHandle(
    ref,
    () => ({
      getActiveDocument: () => {
        const slot = activeSlotRef.current
        if (!slot) return null
        const frame = slot === 'a' ? frameARef.current : frameBRef.current
        return frame?.contentDocument ?? null
      },
      isArmed: () => activeSlotRef.current !== null,
      beginBuild: () => {
        const standbySlot = activeSlotRef.current === 'a' ? 'b' : 'a'
        const frame = standbySlot === 'a' ? frameARef.current : frameBRef.current
        if (!frame?.contentDocument) throw new Error('page-projection: standby iframe not mounted')
        return buildInto(frame.contentDocument, swapTimeoutMs, () => setActiveSlot(standbySlot), onSwap)
      },
    }),
    [swapTimeoutMs, onSwap],
  )

  return (
    <div className={className} style={{ position: 'relative', width, height, overflow: 'hidden' }} data-pp-surface-host="">
      <iframe
        ref={frameARef}
        title="Projected surface (buffer A)"
        sandbox={SURFACE_SANDBOX}
        style={surfaceFrameStyle(activeSlot === 'a')}
      />
      <iframe
        ref={frameBRef}
        title="Projected surface (buffer B)"
        sandbox={SURFACE_SANDBOX}
        style={surfaceFrameStyle(activeSlot === 'b')}
      />
    </div>
  )
})

function surfaceFrameStyle(visible: boolean): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    border: 0,
    visibility: visible ? 'visible' : 'hidden',
  }
}

/**
 * Streams one establish/resync into `doc`'s native parser and resolves the
 * swap-readiness race described in §5.8.5. `doc.write` after `doc.open()`
 * paints progressively — the same way the original site would.
 */
function buildInto(
  doc: Document,
  swapTimeoutMs: number,
  doSwap: () => void,
  onSwap: ((doc: Document) => void) | undefined,
): SurfaceBuildHandle {
  doc.open()
  let cancelled = false
  let swapped = false
  let establishEnded = false
  let cssomReady = false
  let resolveSwap: (doc: Document) => void = () => {}
  const swapPromise = new Promise<Document>((resolve) => {
    resolveSwap = resolve
  })

  const timeoutId = window.setTimeout(() => attemptSwap(true), swapTimeoutMs)

  function attemptSwap(force: boolean): void {
    if (swapped || cancelled) return
    if (!force && !(establishEnded && cssomReady && hasPaintableBody(doc))) return
    swapped = true
    window.clearTimeout(timeoutId)
    doSwap()
    onSwap?.(doc)
    resolveSwap(doc)
  }

  return {
    document: doc,
    writeChunk(html: string) {
      if (cancelled || establishEnded) return
      doc.write(html)
      attemptSwap(false)
    },
    markEstablishEnd() {
      if (cancelled) return
      establishEnded = true
      try {
        doc.close()
      } catch {
        /* already closed */
      }
      attemptSwap(false)
    },
    markCssomReady() {
      if (cancelled) return
      cssomReady = true
      attemptSwap(false)
    },
    swap: () => swapPromise,
    cancel() {
      cancelled = true
      window.clearTimeout(timeoutId)
      try {
        doc.close()
      } catch {
        /* already closed */
      }
    },
  }
}

/** One deliberate layout read at the swap-decision point only — never during frame apply (§5.9.1). */
function hasPaintableBody(doc: Document): boolean {
  const body = doc.body
  if (!body) return false
  const rect = body.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
