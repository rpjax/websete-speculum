import { SessionAuthQueryParam, type PageProjectionIntent } from '@/lib/speculum'
import { w7sPath } from '@/lib/w7s'

export type DomElementInputSender = (input: PageProjectionIntent) => void | Promise<void>

/** Duck type for local-edit / scroll-echo coordination (V2 ProjectionClient or tests). */
export type DomElementInputApplier = {
  noteLocalEdit(anchor: string): void
  consumeScrollEcho(
    target: 'viewport' | string,
    observed: {
      scrollX?: number
      scrollY?: number
      scrollTop?: number
      scrollLeft?: number
    },
  ): boolean
}

export type DomElementInputOptions = {
  sessionId: string
  token: string
  assetBaseUrl?: string
  /** Virtual viewport CSS size (session lockstep). */
  getViewportSize: () => { width: number; height: number }
  getGeneration: () => number
  applier?: DomElementInputApplier | null
  /** Arm pointer only after first document diff for a generation. */
  isArmed: () => boolean
  /** Observe-only: Diff-applied scroll echo consumed (mirror of Virtual scroll echo). */
  onProgrammaticScrollSuppress?: (target: 'viewport' | string) => void
}

/** Matches docs/page-projection/spec/input.md fileUploadInlineMaxBytes default. */
const INLINE_MAX_BYTES = 256 * 1024

/**
 * Capture Projected DOM intents → PageProjectionIntent (CDP path).
 * No wire `click` — motion + pressed/released only.
 */
export function attachDomElementInput(
  surface: HTMLElement,
  send: DomElementInputSender,
  opts: DomElementInputOptions,
): () => void {
  const fire = (input: PageProjectionIntent) => {
    void Promise.resolve(send(input)).catch(() => {})
  }

  let pendingMove: PageProjectionIntent | null = null
  let raf = 0

  const flushMove = () => {
    raf = 0
    if (!pendingMove) return
    const m = pendingMove
    pendingMove = null
    fire(m)
  }

  const queueMove = (input: PageProjectionIntent) => {
    pendingMove = input
    if (raf) return
    raf = requestAnimationFrame(flushMove)
  }

  const INTERACTIVE =
    'a, button, [role="button"], input, select, textarea, summary, label, [role="link"], [role="menuitem"]'

  /**
   * Resolve the Projected intent target under the pointer (I1 hit-test).
   * Prefer the topmost interactive anchored node from elementsFromPoint so a
   * card link wins over a larger category wrapper underneath (SoftNav parity).
   */
  const anchorAtPoint = (clientX: number, clientY: number): string | null => {
    let stack: Element[]
    try {
      stack = document.elementsFromPoint(clientX, clientY)
    } catch {
      stack = []
    }
    let fallback: string | null = null
    for (const node of stack) {
      if (!(node instanceof Element) || !surface.contains(node)) continue
      const anchored =
        (node.closest(INTERACTIVE) instanceof Element
          && (node.closest(INTERACTIVE) as Element).hasAttribute('speculum-anchor')
          ? (node.closest(INTERACTIVE) as Element)
          : null)
        ?? (node.hasAttribute('speculum-anchor') ? node : node.closest('[speculum-anchor]'))
      if (!(anchored instanceof Element) || !surface.contains(anchored)) continue
      const a = anchored.getAttribute('speculum-anchor')
      if (!a) continue
      if (anchored.matches(INTERACTIVE)) return a
      if (!fallback) fallback = a
    }
    return fallback
  }

  const anchorOf = (target: EventTarget | null, point?: { x: number; y: number }): string | null => {
    if (point) {
      const hit = anchorAtPoint(point.x, point.y)
      if (hit) return hit
    }
    if (!(target instanceof Element)) return null
    const actionable = target.closest(INTERACTIVE)
    const el =
      (actionable instanceof Element && actionable.hasAttribute('speculum-anchor')
        ? actionable
        : null) ?? target.closest('[speculum-anchor]')
    return el?.getAttribute('speculum-anchor') ?? null
  }

  /** §6.3: surface CSS → Virtual viewport CSS. */
  const surfaceCoords = (event: MouseEvent | WheelEvent | PointerEvent) => {
    const rect = surface.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const { width: vw, height: vh } = opts.getViewportSize()
    if (vw <= 0 || vh <= 0) return null
    const x = (event.clientX - rect.left) * (vw / rect.width)
    const y = (event.clientY - rect.top) * (vh / rect.height)
    return {
      x: Math.min(Math.max(x, 0), vw),
      y: Math.min(Math.max(y, 0), vh),
    }
  }

  const basePayload = (
    event: MouseEvent | WheelEvent | PointerEvent,
    extra: Record<string, unknown> = {},
  ): string | null => {
    const coords = surfaceCoords(event)
    if (!coords) return null
    return JSON.stringify({
      x: coords.x,
      y: coords.y,
      button: 'button' in event ? event.button : 0,
      buttons: 'buttons' in event ? event.buttons : 0,
      modifiers: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      },
      pointerType: 'pointerType' in event ? event.pointerType : 'mouse',
      pointerId: 'pointerId' in event ? event.pointerId : 1,
      ...extra,
    })
  }

  const intent = (
    type: string,
    anchor: string | null,
    payload: string,
  ): PageProjectionIntent => ({
    generation: opts.getGeneration(),
    type,
    anchor,
    timestampClient: performance.now(),
    payload,
  })

  const onPointerMove = (event: PointerEvent) => {
    if (!opts.isArmed()) return
    const payload = basePayload(event)
    if (!payload) return
    queueMove(intent('mousemove', null, payload))
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!opts.isArmed()) return
    if (raf) {
      cancelAnimationFrame(raf)
      flushMove()
    }
    const payload = basePayload(event)
    if (!payload) return
    fire(intent('mousedown', anchorOf(event.target, { x: event.clientX, y: event.clientY }), payload))
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!opts.isArmed()) return
    if (raf) {
      cancelAnimationFrame(raf)
      flushMove()
    }
    const payload = basePayload(event)
    if (!payload) return
    fire(intent('mouseup', anchorOf(event.target, { x: event.clientX, y: event.clientY }), payload))
  }

  const onClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const onSubmit = (event: Event) => {
    // Forms must never navigate the Speculum Live SPA (action may be absolute https).
    event.preventDefault()
    event.stopPropagation()
  }

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }

  const onWheel = (event: WheelEvent) => {
    if (!opts.isArmed()) return
    event.preventDefault()
    const payload = basePayload(event, {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
    })
    if (!payload) return
    fire(intent('wheel', anchorOf(event.target, { x: event.clientX, y: event.clientY }), payload))
  }

  const onInput = (event: Event) => {
    if (!opts.isArmed()) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const anchor = anchorOf(target)
    if (!anchor) return
    opts.applier?.noteLocalEdit(anchor)

    if (target instanceof HTMLInputElement && target.type === 'file') {
      return
    }

    // Prefer keydown/insertText for typing; only sync value on change / non-insert.
    if (
      event.type === 'input'
      && event instanceof InputEvent
      && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      && target.type !== 'checkbox'
      && target.type !== 'radio'
      && typeof event.inputType === 'string'
      && event.inputType.startsWith('insert')
    ) {
      return
    }

    let value = ''
    let checked: boolean | undefined
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
    ) {
      value = target.value
      if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
        checked = target.checked
      }
    }
    fire(intent('input', anchor, JSON.stringify({ value, checked })))
  }

  const onFileActivate = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'file') return
    event.preventDefault()
    event.stopPropagation()
    if (!opts.isArmed()) return
    const anchor = anchorOf(target)
    if (!anchor) return

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
        const refs = []
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
            const base = (opts.assetBaseUrl ?? '').replace(/\/$/, '')
            const path = w7sPath(
              `/api/sessions/${opts.sessionId}/dom-uploads`
              + `?uploadId=${encodeURIComponent(uploadId)}`
              + `&name=${encodeURIComponent(file.name)}`
              + `&${SessionAuthQueryParam}=${encodeURIComponent(opts.token)}`,
            )
            await fetch(`${base}${path}`, {
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
        fire(intent('setFiles', anchor, JSON.stringify({ files: refs })))
      })()
    })
    picker.click()
  }

  const onKey = (event: KeyboardEvent) => {
    if (!opts.isArmed()) return
    // Enter on links/buttons would activate default navigation in the host page.
    if (
      event.key === 'Enter'
      && (event.target instanceof HTMLAnchorElement
        || (event.target instanceof HTMLButtonElement && event.target.type === 'submit')
        || (event.target instanceof HTMLInputElement
          && (event.target.type === 'submit' || event.target.type === 'image')))
    ) {
      event.preventDefault()
      event.stopPropagation()
    }
    const anchor = anchorOf(event.target)
    fire(
      intent(event.type === 'keyup' ? 'keyup' : 'keydown', anchor, JSON.stringify({
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        location: event.location,
        modifiers: {
          alt: event.altKey,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          shift: event.shiftKey,
        },
      })),
    )
  }

  /**
   * The surface is the projected document scroller, so scrolling it is a
   * viewport move (`scrollX/scrollY`); any inner scroller is an element move
   * addressed by its anchor. Coalesce per scroller → last sample (I1).
   */
  let scrollRaf = 0
  let pendingViewport: PageProjectionIntent | null = null
  const pendingElements = new Map<string, PageProjectionIntent>()

  const flushScroll = () => {
    scrollRaf = 0
    if (pendingViewport) {
      const v = pendingViewport
      pendingViewport = null
      fire(v)
    }
    for (const [anchor, intentMsg] of pendingElements) {
      pendingElements.delete(anchor)
      fire(intentMsg)
    }
  }

  const onScroll = (event: Event) => {
    if (!opts.isArmed()) return
    const el = event.target
    if (el === surface || el === document || el === document.scrollingElement) {
      const scrollX = surface.scrollLeft
      const scrollY = surface.scrollTop
      if (opts.applier?.consumeScrollEcho('viewport', { scrollX, scrollY })) {
        opts.onProgrammaticScrollSuppress?.('viewport')
        return
      }
      pendingViewport = intent('scrollViewport', null, JSON.stringify({ scrollX, scrollY }))
      if (!scrollRaf) scrollRaf = requestAnimationFrame(flushScroll)
      return
    }
    if (!(el instanceof Element)) return
    const anchor = el.getAttribute('speculum-anchor')
    if (!anchor) return
    const scrollTop = el.scrollTop
    const scrollLeft = el.scrollLeft
    if (opts.applier?.consumeScrollEcho(anchor, { scrollTop, scrollLeft })) {
      opts.onProgrammaticScrollSuppress?.(anchor)
      return
    }
    pendingElements.set(
      anchor,
      intent('scrollElement', anchor, JSON.stringify({ scrollTop, scrollLeft })),
    )
    if (!scrollRaf) scrollRaf = requestAnimationFrame(flushScroll)
  }

  const onFocusIn = (event: FocusEvent) => {
    if (!opts.isArmed()) return
    const anchor = anchorOf(event.target)
    if (!anchor) return
    fire(intent('focus', anchor, '{}'))
  }

  const onFocusOut = (event: FocusEvent) => {
    if (!opts.isArmed()) return
    const anchor = anchorOf(event.target)
    if (!anchor) return
    fire(intent('blur', anchor, '{}'))
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
  surface.addEventListener('click', onFileActivate, true)
  surface.addEventListener('keydown', onKey, true)
  surface.addEventListener('keyup', onKey, true)
  surface.addEventListener('scroll', onScroll, true)
  surface.addEventListener('focusin', onFocusIn, true)
  surface.addEventListener('focusout', onFocusOut, true)

  return () => {
    if (raf) cancelAnimationFrame(raf)
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
    surface.removeEventListener('click', onFileActivate, true)
    surface.removeEventListener('keydown', onKey, true)
    surface.removeEventListener('keyup', onKey, true)
    surface.removeEventListener('scroll', onScroll, true)
    surface.removeEventListener('focusin', onFocusIn, true)
    surface.removeEventListener('focusout', onFocusOut, true)
  }
}
