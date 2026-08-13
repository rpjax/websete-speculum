/**
 * Projected surface host — docs/page-projection/spec/engine-redesign.md §5.8.
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
 * or `swapTimeoutMs` elapses after establishEnd+cssomReady (layout wait only),
 * whichever comes first (§5.8.5). Never swap without cssomInstall success.
 */
import type { CSSProperties } from 'react'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

/** One in-flight establish/resync build targeting the standby buffer. */
export interface SurfaceBuildHandle {
  readonly document: Document
  /** Feeds one HTML chunk into the standby document's streaming parser (§5.6.4). */
  writeChunk(html: string): void
  /** Closes the parser without swapping — call before establishEnd checksum verify. */
  finalizeParser(): void
  /** `establishEnd` applied — closes the parser (if needed) and re-checks the swap threshold. */
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
        if (!frame) throw new Error('page-projection: standby iframe not mounted')
        // Pass the iframe element — document.open() can replace contentDocument;
        // always read it fresh from the frame (§5.6 / SurfaceBuildHandle).
        return buildInto(frame, swapTimeoutMs, () => setActiveSlot(standbySlot), onSwap)
      },
    }),
    [swapTimeoutMs, onSwap],
  )

  return (
    <div
      className={className}
      style={{ position: 'relative', width, height, overflow: 'hidden' }}
      data-pp-surface-host=""
      data-speculum-dom-surface=""
      data-speculum-armed={activeSlot ? 'true' : 'false'}
    >
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
  frame: HTMLIFrameElement,
  swapTimeoutMs: number,
  doSwap: () => void,
  onSwap: ((doc: Document) => void) | undefined,
): SurfaceBuildHandle {
  const initial = frame.contentDocument
  if (!initial) throw new Error('page-projection: standby iframe has no contentDocument')
  initial.open()
  /** Always resolve through the iframe — `Document.open()` may replace the Document object. */
  const currentDoc = (): Document => {
    const doc = frame.contentDocument
    if (!doc) throw new Error('page-projection: standby iframe lost contentDocument')
    return doc
  }
  let cancelled = false
  let swapped = false
  let establishEnded = false
  let cssomReady = false
  let timeoutId: number | null = null
  let resolveSwap: (doc: Document) => void = () => {}
  const swapPromise = new Promise<Document>((resolve) => {
    resolveSwap = resolve
  })

  function clearForceTimer(): void {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  /** §5.8.5 — force timer starts only after establishEnd+cssomReady (skips layout wait only). */
  function armForceTimer(): void {
    if (timeoutId != null || swapped || cancelled) return
    if (!(establishEnded && cssomReady)) return
    timeoutId = window.setTimeout(() => attemptSwap(true), swapTimeoutMs)
  }

  function attemptSwap(force: boolean): void {
    if (swapped || cancelled) return
    const doc = currentDoc()
    // Never arm without establishEnd + cssomInstall (unstyled/black).
    if (!(establishEnded && cssomReady)) return
    if (!force && !hasPaintableBody(doc)) return
    swapped = true
    clearForceTimer()
    doSwap()
    onSwap?.(doc)
    resolveSwap(doc)
  }

  return {
    get document() {
      return currentDoc()
    },
    writeChunk(html: string) {
      if (cancelled || establishEnded) return
      currentDoc().write(html)
      attemptSwap(false)
    },
    finalizeParser() {
      if (cancelled || establishEnded) return
      establishEnded = true
      try {
        currentDoc().close()
      } catch {
        /* already closed */
      }
      armForceTimer()
    },
    markEstablishEnd() {
      if (cancelled) return
      if (!establishEnded) {
        establishEnded = true
        try {
          currentDoc().close()
        } catch {
          /* already closed */
        }
      }
      armForceTimer()
      attemptSwap(false)
    },
    markCssomReady() {
      if (cancelled) return
      cssomReady = true
      armForceTimer()
      attemptSwap(false)
    },
    swap: () => swapPromise,
    cancel() {
      cancelled = true
      clearForceTimer()
      try {
        frame.contentDocument?.close()
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
