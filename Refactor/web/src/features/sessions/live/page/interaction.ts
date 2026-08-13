/**
 * Local-first interaction — docs/page-projection/spec/engine-redesign.md §5.9, §5.11.
 *
 * Perception is local; truth is authoritative (D6). Hover/active/focus-visible
 * and CSS transitions are free once the surface is a real document — nothing
 * to do here. Scroll paints natively and is reported as a coalesced intent.
 * Caret position is client-authoritative (§5.9.3): an upstream value patch
 * must never move it. Intents address by `uint32` id via the registry's
 * reverse map (§5.11.1); none are sent before arm, and all stop while desynced.
 */
import type { PageProjectionRegistry } from './registry'

export interface PageProjectionIntentWire {
  generation: number
  type: string
  /** §5.11.1 — resolved through the registry's reverse map; `null` when untargeted. */
  nodeId: number | null
  timestampClient: number
  payload: string
}

export type PageProjectionIntentSender = (intent: PageProjectionIntentWire) => void | Promise<void>

export interface InteractionOptions {
  getGeneration: () => number
  getViewportSize: () => { width: number; height: number }
  /** No intents before arm; disarmed while desynced (§5.6.7, §5.7.1). */
  isArmed: () => boolean
  onProgrammaticScrollSuppress?: (target: 'viewport' | number) => void
  /** Dom-plane echo filter mirror (§5.9.4) — true suppresses the intent. */
  consumeScrollEcho?: (target: 'viewport' | number, observed: { top: number; left: number }) => boolean
  /** Required for `setFiles` upload path (§6.9). Prefer live getters. */
  sessionId?: string | null
  token?: string | null
  assetBaseUrl?: string
  getSessionId?: () => string | null | undefined
  getToken?: () => string | null | undefined
  getAssetBaseUrl?: () => string | undefined
}

const INTERACTIVE =
  'a, button, [role="button"], input, select, textarea, summary, label, [role="link"], [role="menuitem"]'

/**
 * Applies an upstream control value without moving the caret (§5.9.3). Safe to
 * call unconditionally from `patch` apply — a blurred control is simply set;
 * a focused one is diffed so the logical caret position survives.
 */
export function reconcileControlValue(el: HTMLInputElement | HTMLTextAreaElement, nextValue: string): boolean {
  const prevValue = el.value
  if (prevValue === nextValue) return true
  const focused = document.activeElement === el && el.selectionStart != null
  if (!focused) {
    el.value = nextValue
    return true
  }
  const caret = el.selectionStart!
  const prefixLen = commonPrefixLength(prevValue, nextValue)
  const suffixLen = commonSuffixLength(prevValue, nextValue, prefixLen)
  el.value = nextValue
  let preserved = true
  let nextCaret: number
  if (caret <= prefixLen) {
    nextCaret = caret
  } else if (caret >= prevValue.length - suffixLen) {
    nextCaret = nextValue.length - (prevValue.length - caret)
  } else {
    // Caret sat inside the rewritten middle span — clamp; report the conflict (§5.9.3.3).
    nextCaret = prefixLen
    preserved = false
  }
  nextCaret = Math.min(Math.max(nextCaret, 0), nextValue.length)
  try {
    el.setSelectionRange(nextCaret, nextCaret)
  } catch {
    /* selection API unsupported on this input type (e.g. type=email) */
  }
  return preserved
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) i++
  return i
}

function commonSuffixLength(a: string, b: string, prefixLen: number): number {
  const max = Math.min(a.length, b.length) - prefixLen
  let i = 0
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

/** `document.visibilityState` → the control-channel `visibility` field (§5.9.5). */
export function attachVisibilityReporter(
  doc: Document,
  onChange: (visibility: 'visible' | 'hidden') => void,
): () => void {
  const report = () => onChange(doc.visibilityState === 'hidden' ? 'hidden' : 'visible')
  report()
  doc.addEventListener('visibilitychange', report)
  return () => doc.removeEventListener('visibilitychange', report)
}

/**
 * Attaches local-first pointer/keyboard/scroll capture to the Projected
 * surface document, emitting id-addressed intents. Returns a detach function.
 */
export function attachPageProjectionInteraction(
  surface: HTMLElement,
  registry: PageProjectionRegistry,
  send: PageProjectionIntentSender,
  opts: InteractionOptions,
): () => void {
  const fire = (intent: PageProjectionIntentWire) => {
    if (!opts.isArmed()) return
    void Promise.resolve(send(intent)).catch(() => {})
  }
  const intent = (type: string, nodeId: number | null, payload: string): PageProjectionIntentWire => ({
    generation: opts.getGeneration(),
    type,
    nodeId,
    timestampClient: performance.now(),
    payload,
  })

  const nodeIdAtPoint = (clientX: number, clientY: number): number | null => {
    const parentDoc = surface.ownerDocument
    let stack: Element[]
    try {
      stack = parentDoc.elementsFromPoint(clientX, clientY)
    } catch {
      stack = []
    }
    // Same-origin projected iframe — hit-test inside the active buffer (parent
    // elementsFromPoint only returns the <iframe> element itself).
    for (const node of stack) {
      if (!(node instanceof HTMLIFrameElement) || !surface.contains(node)) continue
      const childDoc = node.contentDocument
      if (!childDoc) continue
      const rect = node.getBoundingClientRect()
      const cx = clientX - rect.left
      const cy = clientY - rect.top
      let inner: Element[]
      try {
        inner = childDoc.elementsFromPoint(cx, cy)
      } catch {
        continue
      }
      const hit = pickInteractiveId(inner)
      if (hit != null) return hit
    }
    return pickInteractiveId(stack.filter((n) => surface.contains(n)))
  }

  const pickInteractiveId = (stack: Element[]): number | null => {
    let fallback: number | null = null
    for (const node of stack) {
      const anchored = node.closest(INTERACTIVE) ?? node
      const id = registry.idOfNearest(anchored)
      if (id == null) continue
      if (anchored.matches(INTERACTIVE)) return id
      if (fallback == null) fallback = id
    }
    return fallback
  }

  const nodeIdOf = (target: EventTarget | null, point?: { x: number; y: number }): number | null => {
    if (point) {
      const hit = nodeIdAtPoint(point.x, point.y)
      if (hit != null) return hit
    }
    if (!(target instanceof Node)) return null
    return registry.idOfNearest(target) ?? null
  }

  const surfaceCoords = (event: MouseEvent | WheelEvent | PointerEvent) => {
    const rect = surface.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const { width: vw, height: vh } = opts.getViewportSize()
    if (vw <= 0 || vh <= 0) return null
    const x = (event.clientX - rect.left) * (vw / rect.width)
    const y = (event.clientY - rect.top) * (vh / rect.height)
    return { x: Math.min(Math.max(x, 0), vw), y: Math.min(Math.max(y, 0), vh) }
  }

  const basePayload = (event: MouseEvent | WheelEvent | PointerEvent, extra: Record<string, unknown> = {}) => {
    const coords = surfaceCoords(event)
    if (!coords) return null
    return JSON.stringify({
      x: coords.x,
      y: coords.y,
      button: 'button' in event ? event.button : 0,
      buttons: 'buttons' in event ? event.buttons : 0,
      modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
      ...extra,
    })
  }

  let moveRaf = 0
  let pendingMove: PageProjectionIntentWire | null = null
  const flushMove = () => {
    moveRaf = 0
    const m = pendingMove
    pendingMove = null
    if (m) fire(m)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!opts.isArmed()) return
    const payload = basePayload(event)
    if (!payload) return
    pendingMove = intent('mousemove', null, payload)
    if (!moveRaf) moveRaf = requestAnimationFrame(flushMove)
  }
  const onPointerDown = (event: PointerEvent) => {
    if (!opts.isArmed()) return
    if (moveRaf) {
      cancelAnimationFrame(moveRaf)
      flushMove()
    }
    const payload = basePayload(event)
    if (!payload) return
    fire(intent('mousedown', nodeIdOf(event.target, { x: event.clientX, y: event.clientY }), payload))
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!opts.isArmed()) return
    const payload = basePayload(event)
    if (!payload) return
    fire(intent('mouseup', nodeIdOf(event.target, { x: event.clientX, y: event.clientY }), payload))
  }
  const onClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const onSubmit = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const onContextMenu = (event: MouseEvent) => event.preventDefault()
  const onWheel = (event: WheelEvent) => {
    if (!opts.isArmed()) return
    event.preventDefault()
    const payload = basePayload(event, { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode })
    if (!payload) return
    fire(intent('wheel', nodeIdOf(event.target, { x: event.clientX, y: event.clientY }), payload))
  }

  const onInput = (event: Event) => {
    if (!opts.isArmed()) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const nodeId = registry.idOfNearest(target)
    if (nodeId == null) return
    let value = ''
    let checked: boolean | undefined
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      value = target.value
      if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
        checked = target.checked
      }
    }
    fire(intent('input', nodeId, JSON.stringify({ value, checked })))
  }

  const onKey = (event: KeyboardEvent) => {
    if (!opts.isArmed()) return
    if (
      event.key === 'Enter' &&
      (event.target instanceof HTMLAnchorElement ||
        (event.target instanceof HTMLButtonElement && event.target.type === 'submit') ||
        (event.target instanceof HTMLInputElement && (event.target.type === 'submit' || event.target.type === 'image')))
    ) {
      event.preventDefault()
      event.stopPropagation()
    }
    const nodeId = nodeIdOf(event.target)
    fire(
      intent(
        event.type === 'keyup' ? 'keyup' : 'keydown',
        nodeId,
        JSON.stringify({
          key: event.key,
          code: event.code,
          repeat: event.repeat,
          modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
        }),
      ),
    )
  }

  // Scroll paints natively at once (P4) — coalesce the resulting intent per scroller (§5.9.4).
  let scrollRaf = 0
  let pendingViewport: PageProjectionIntentWire | null = null
  const pendingElements = new Map<number, PageProjectionIntentWire>()
  const flushScroll = () => {
    scrollRaf = 0
    if (pendingViewport) {
      const v = pendingViewport
      pendingViewport = null
      fire(v)
    }
    for (const [id, msg] of pendingElements) {
      pendingElements.delete(id)
      fire(msg)
    }
  }
  const onScroll = (event: Event) => {
    if (!opts.isArmed()) return
    const el = event.target
    const doc = surface.ownerDocument
    if (el === doc || el === doc.defaultView) {
      const win = doc.defaultView!
      const top = win.scrollY
      const left = win.scrollX
      if (opts.consumeScrollEcho?.('viewport', { top, left })) {
        opts.onProgrammaticScrollSuppress?.('viewport')
        return
      }
      pendingViewport = intent('scrollViewport', null, JSON.stringify({ scrollX: left, scrollY: top }))
      if (!scrollRaf) scrollRaf = requestAnimationFrame(flushScroll)
      return
    }
    if (!(el instanceof Element)) return
    const nodeId = registry.idOfNearest(el)
    if (nodeId == null) return
    const top = el.scrollTop
    const left = el.scrollLeft
    if (opts.consumeScrollEcho?.(nodeId, { top, left })) {
      opts.onProgrammaticScrollSuppress?.(nodeId)
      return
    }
    pendingElements.set(nodeId, intent('scrollElement', nodeId, JSON.stringify({ scrollTop: top, scrollLeft: left })))
    if (!scrollRaf) scrollRaf = requestAnimationFrame(flushScroll)
  }

  const onFocusIn = (event: FocusEvent) => {
    if (!opts.isArmed()) return
    const nodeId = nodeIdOf(event.target)
    if (nodeId == null) return
    fire(intent('focus', nodeId, '{}'))
  }
  const onFocusOut = (event: FocusEvent) => {
    if (!opts.isArmed()) return
    const nodeId = nodeIdOf(event.target)
    if (nodeId == null) return
    fire(intent('blur', nodeId, '{}'))
  }

  const INLINE_MAX_BYTES = 256 * 1024
  const onFileActivate = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'file') return
    event.preventDefault()
    event.stopPropagation()
    if (!opts.isArmed()) return
    const nodeId = registry.idOfNearest(target)
    if (nodeId == null) return
    const sid = opts.getSessionId?.() ?? opts.sessionId
    const tok = opts.getToken?.() ?? opts.token
    if (!sid || !tok) return

    const picker = document.createElement('input')
    picker.type = 'file'
    picker.multiple = target.multiple
    if (target.accept) picker.accept = target.accept
    picker.style.display = 'none'
    document.body.appendChild(picker)
    picker.addEventListener('change', () => {
      void (async () => {
        const files = Array.from(picker.files ?? [])
        document.body.removeChild(picker)
        if (!files.length) return
        const refs: Array<Record<string, unknown>> = []
        for (const file of files) {
          if (file.size <= INLINE_MAX_BYTES) {
            const buf = new Uint8Array(await file.arrayBuffer())
            let binary = ''
            for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!)
            refs.push({
              name: file.name,
              type: file.type,
              lastModified: file.lastModified,
              size: file.size,
              bytesBase64: btoa(binary),
            })
          } else {
            const uploadId = crypto.randomUUID().replace(/-/g, '')
            const base =
              (opts.getAssetBaseUrl?.() ?? opts.assetBaseUrl ?? '').replace(/\/$/, '') || window.location.origin
            const url = new URL(`/w7s/api/sessions/${sid}/dom-uploads`, base)
            url.searchParams.set('uploadId', uploadId)
            url.searchParams.set('name', file.name)
            url.searchParams.set('speculum-session-token', tok)
            await fetch(url.toString(), {
              method: 'POST',
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
              body: file,
            })
            refs.push({
              uploadId,
              name: file.name,
              type: file.type,
              lastModified: file.lastModified,
              size: file.size,
            })
          }
        }
        fire(intent('setFiles', nodeId, JSON.stringify({ files: refs })))
      })()
    })
    picker.click()
  }

  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointerup', onPointerUp)
  surface.addEventListener('click', onClick, true)
  surface.addEventListener('submit', onSubmit, true)
  surface.addEventListener('contextmenu', onContextMenu, true)
  surface.addEventListener('wheel', onWheel, { passive: false })
  surface.addEventListener('input', onInput, true)
  surface.addEventListener('change', onInput, true)
  surface.addEventListener('keydown', onKey, true)
  surface.addEventListener('keyup', onKey, true)
  surface.addEventListener('scroll', onScroll, true)
  surface.addEventListener('focusin', onFocusIn, true)
  surface.addEventListener('focusout', onFocusOut, true)
  surface.addEventListener('click', onFileActivate, true)

  return () => {
    if (moveRaf) cancelAnimationFrame(moveRaf)
    if (scrollRaf) cancelAnimationFrame(scrollRaf)
    surface.removeEventListener('pointermove', onPointerMove)
    surface.removeEventListener('pointerdown', onPointerDown)
    surface.removeEventListener('pointerup', onPointerUp)
    surface.removeEventListener('click', onClick, true)
    surface.removeEventListener('submit', onSubmit, true)
    surface.removeEventListener('contextmenu', onContextMenu, true)
    surface.removeEventListener('wheel', onWheel)
    surface.removeEventListener('input', onInput, true)
    surface.removeEventListener('change', onInput, true)
    surface.removeEventListener('keydown', onKey, true)
    surface.removeEventListener('keyup', onKey, true)
    surface.removeEventListener('scroll', onScroll, true)
    surface.removeEventListener('focusin', onFocusIn, true)
    surface.removeEventListener('focusout', onFocusOut, true)
    surface.removeEventListener('click', onFileActivate, true)
  }
}
