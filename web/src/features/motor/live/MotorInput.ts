import type * as signalR from '@microsoft/signalr'
import type { MotorElements } from './types'
import {
  buildTouchPayload,
  canvasToPageCoords,
  isLocalBrowserShortcut,
  normalizeWheelDeltas,
  shouldThrottleMove,
  type TouchPhase,
  type TouchPointWire,
} from './motorInputCoords'

export type UserInputSubject = signalR.Subject<string>

export interface MotorInputDeps {
  getConnection: () => signalR.HubConnection | null
  getSessionSize: () => { w: number; h: number }
  getCurrentUrl: () => string
  /** When true, keyboard shell may claim focus without fighting canvas capture. */
  isEditingActive?: () => boolean
  /** Fired when the hidden IME field gains/loses DOM focus (OS keyboard may open). */
  onImeFocusChange?: (focused: boolean) => void
  /**
   * Touch-primary session (mobile / coarse pointer): suppress hover mouse and
   * treat pen as touch so remote pages do not get desktop :hover flicks.
   */
  isTouchPrimary?: () => boolean
}

type ActiveTouch = {
  pointerId: number
  clientX: number
  clientY: number
  radiusX: number
  radiusY: number
  force: number
}

/** Suppress synthetic mouse after touch (browser compatibility click). */
const MOUSE_SUPPRESS_AFTER_TOUCH_MS = 600

/**
 * Captures pointer/keyboard/wheel on the Motor canvas and relays JSON to the hub.
 * Touch uses a dedicated wire family; mouse stays on legacy mouse events.
 * Mouse buttons are tracked per-button (chord-safe); touch is tracked per pointerId.
 */
export class MotorInput {
  private heldKeys = new Set<string>()
  /** Chord-safe: mouse uses one pointerId for all buttons. */
  private pressedMouseButtons = new Set<number>()
  private activeTouches = new Map<number, ActiveTouch>()
  private lastMousePage = { x: 0, y: 0 }
  private cachedRect: DOMRect | null = null
  private lastTouchMoveTime = 0
  private lastMouseMoveTime = 0
  private suppressMouseUntil = 0
  private cleanupFns: Array<() => void> = []
  private userInputSubject: UserInputSubject | null = null
  private elements: MotorElements | null = null
  private deps: MotorInputDeps
  private imeEl: HTMLTextAreaElement | null = null
  private composing = false

  constructor(deps: MotorInputDeps) {
    this.deps = deps
  }

  setUserInputSubject(subject: UserInputSubject | null) {
    this.userInputSubject = subject
  }

  clearPointerState() {
    this.heldKeys.clear()
    this.pressedMouseButtons.clear()
    this.activeTouches.clear()
  }

  invalidateRect() {
    this.cachedRect = null
  }

  /** Focus the hidden IME field so the OS virtual keyboard can open. */
  focusIme() {
    this.imeEl?.focus({ preventScroll: true })
  }

  blurIme() {
    this.imeEl?.blur()
  }

  isImeFocused(): boolean {
    return !!this.imeEl && document.activeElement === this.imeEl
  }

  setImeElement(el: HTMLTextAreaElement | null) {
    this.imeEl = el
  }

  bind(elements: MotorElements) {
    this.unbind()
    this.elements = elements
    const { canvas, urlBar } = elements

    const on = (el: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, opts)
      this.cleanupFns.push(() => el.removeEventListener(type, fn, opts))
    }

    on(canvas, 'pointerdown', (e) => {
      const ev = e as PointerEvent
      this.invalidateRect()
      const kind = this.classifyPointer(ev)

      if (kind === 'mouse') {
        if (this.shouldIgnoreMouse()) return
        if (ev.button !== 0 && ev.button !== 1 && ev.button !== 2) return
        ev.preventDefault()
        canvas.focus()
        try { canvas.setPointerCapture(ev.pointerId) } catch { /* ignore */ }
        this.pressedMouseButtons.add(ev.button)
        const { x, y } = this.pageCoords(ev.clientX, ev.clientY)
        this.lastMousePage = { x, y }
        this.sendInput({ type: 'mousedown', x, y, button: ev.button })
        return
      }

      // touch (native touch or pen in touch-primary mode)
      ev.preventDefault()
      canvas.focus()
      try { canvas.setPointerCapture(ev.pointerId) } catch { /* ignore */ }
      this.suppressMouseUntil = performance.now() + MOUSE_SUPPRESS_AFTER_TOUCH_MS
      this.trackTouch(ev)
      this.emitTouch('start', [ev.pointerId])
    })

    on(canvas, 'pointermove', (e) => {
      const ev = e as PointerEvent
      const kind = this.classifyPointer(ev)

      if (kind === 'touch') {
        if (!this.activeTouches.has(ev.pointerId)) return
        this.trackTouch(ev)
        const now = performance.now()
        if (shouldThrottleMove(now, this.lastTouchMoveTime)) return
        this.lastTouchMoveTime = now
        this.emitTouch('move', [ev.pointerId])
        return
      }

      if (this.shouldIgnoreMouse()) return

      // Desktop mouse: hover only when not touch-primary; drag always when buttons down.
      const touchPrimary = !!this.deps.isTouchPrimary?.()
      const dragging = this.pressedMouseButtons.size > 0 || (ev.buttons ?? 0) !== 0
      if (touchPrimary && !dragging) return

      const now = performance.now()
      if (shouldThrottleMove(now, this.lastMouseMoveTime)) return
      this.lastMouseMoveTime = now
      const { x, y } = this.pageCoords(ev.clientX, ev.clientY)
      this.lastMousePage = { x, y }
      this.sendInput({ type: 'mousemove', x, y })
    })

    const endPointer = (phase: 'end' | 'cancel') => (e: Event) => {
      const ev = e as PointerEvent
      const kind = this.classifyPointer(ev)

      if (kind === 'touch' || this.activeTouches.has(ev.pointerId)) {
        if (!this.activeTouches.has(ev.pointerId)) return
        ev.preventDefault()
        this.trackTouch(ev)
        this.emitTouch(phase, [ev.pointerId])
        this.activeTouches.delete(ev.pointerId)
        this.suppressMouseUntil = performance.now() + MOUSE_SUPPRESS_AFTER_TOUCH_MS
        try { canvas.releasePointerCapture(ev.pointerId) } catch { /* ignore */ }
        return
      }

      if (this.shouldIgnoreMouse()) return

      if (phase === 'cancel') {
        if (this.pressedMouseButtons.size === 0) return
        ev.preventDefault()
        const { x, y } = this.pageCoords(ev.clientX, ev.clientY)
        this.lastMousePage = { x, y }
        for (const button of [...this.pressedMouseButtons]) {
          this.sendInput({ type: 'mouseup', x, y, button })
        }
        this.pressedMouseButtons.clear()
        try { canvas.releasePointerCapture(ev.pointerId) } catch { /* ignore */ }
        return
      }

      if (!this.pressedMouseButtons.has(ev.button)) return
      ev.preventDefault()
      this.pressedMouseButtons.delete(ev.button)
      const { x, y } = this.pageCoords(ev.clientX, ev.clientY)
      this.lastMousePage = { x, y }
      this.sendInput({ type: 'mouseup', x, y, button: ev.button })
      if (this.pressedMouseButtons.size === 0) {
        try { canvas.releasePointerCapture(ev.pointerId) } catch { /* ignore */ }
      }
    }
    on(canvas, 'pointerup', endPointer('end'))
    on(canvas, 'pointercancel', endPointer('cancel'))
    on(window, 'pointerup', endPointer('end'))
    on(window, 'pointercancel', endPointer('cancel'))
    on(canvas, 'lostpointercapture', (e) => {
      const ev = e as PointerEvent
      if (this.activeTouches.has(ev.pointerId)) {
        this.trackTouch(ev)
        this.emitTouch('cancel', [ev.pointerId])
        this.activeTouches.delete(ev.pointerId)
        this.suppressMouseUntil = performance.now() + MOUSE_SUPPRESS_AFTER_TOUCH_MS
      }
      if (this.pressedMouseButtons.size === 0) return
      const { x, y } = this.lastMousePage
      for (const button of [...this.pressedMouseButtons]) {
        this.sendInput({ type: 'mouseup', x, y, button })
      }
      this.pressedMouseButtons.clear()
    })

    on(canvas, 'contextmenu', (e) => (e as Event).preventDefault())

    on(canvas, 'wheel', (e) => {
      const ev = e as WheelEvent
      ev.preventDefault()
      this.invalidateRect()
      const { x, y } = this.pageCoords(ev.clientX, ev.clientY)
      const { deltaX, deltaY } = normalizeWheelDeltas(
        ev.deltaX, ev.deltaY, ev.deltaMode, canvas.clientWidth, canvas.clientHeight)
      this.sendInput({ type: 'wheel', x, y, deltaX, deltaY })
    }, { passive: false })

    canvas.setAttribute('tabindex', '0')
    on(canvas, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (isLocalBrowserShortcut(ev.key, ev.ctrlKey || ev.metaKey)) return
      if (this.deps.isEditingActive?.()) return
      ev.preventDefault()
      this.heldKeys.add(ev.key)
      this.sendInput({ type: 'keydown', key: ev.key })
    })
    on(canvas, 'keyup', (e) => {
      const ev = e as KeyboardEvent
      if (!this.heldKeys.has(ev.key)) return
      this.heldKeys.delete(ev.key)
      this.sendInput({ type: 'keyup', key: ev.key })
    })
    on(canvas, 'blur', () => {
      for (const key of this.heldKeys) this.sendInput({ type: 'keyup', key })
      this.heldKeys.clear()
      if (this.pressedMouseButtons.size === 0) return
      const { x, y } = this.lastMousePage
      for (const button of [...this.pressedMouseButtons]) {
        this.sendInput({ type: 'mouseup', x, y, button })
      }
      this.pressedMouseButtons.clear()
    })

    on(urlBar, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (ev.key === 'Enter') {
        ev.preventDefault()
        const raw = urlBar.value.trim()
        if (!raw) { urlBar.value = this.deps.getCurrentUrl(); return }
        const target = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
        urlBar.value = target
        urlBar.blur()
        canvas.focus()
        this.deps.getConnection()?.invoke('NavigateAsync', target).catch(console.error)
      } else if (ev.key === 'Escape') {
        urlBar.value = this.deps.getCurrentUrl()
        urlBar.blur()
        canvas.focus()
      }
      ev.stopPropagation()
    })
    on(urlBar, 'blur', () => { urlBar.value = this.deps.getCurrentUrl() })
    on(urlBar, 'focus', () => urlBar.select())

    if (this.imeEl) this.bindIme(this.imeEl, on)
  }

  bindIme(ime: HTMLTextAreaElement, on = (
    el: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions,
  ) => {
    el.addEventListener(type, fn, opts)
    this.cleanupFns.push(() => el.removeEventListener(type, fn, opts))
  }) {
    on(ime, 'focus', () => {
      this.invalidateRect()
      this.deps.onImeFocusChange?.(true)
    })
    on(ime, 'blur', () => {
      this.invalidateRect()
      this.deps.onImeFocusChange?.(false)
    })
    on(ime, 'compositionstart', () => { this.composing = true })
    on(ime, 'compositionend', (e) => {
      this.composing = false
      const data = (e as CompositionEvent).data
      if (data) this.sendInput({ type: 'text', text: data, source: 'composition' })
      ime.value = ''
    })
    on(ime, 'beforeinput', (e) => {
      const ev = e as InputEvent
      if (this.composing) return
      if (ev.inputType === 'insertText' && ev.data) {
        ev.preventDefault()
        this.sendInput({ type: 'text', text: ev.data, source: 'insert' })
        ime.value = ''
      } else if (ev.inputType === 'insertCompositionText') {
        // Wait for compositionend
      } else if (ev.inputType === 'deleteContentBackward') {
        ev.preventDefault()
        this.sendInput({ type: 'keydown', key: 'Backspace' })
        this.sendInput({ type: 'keyup', key: 'Backspace' })
      } else if (ev.inputType === 'insertLineBreak' || ev.inputType === 'insertParagraph') {
        ev.preventDefault()
        this.sendInput({ type: 'keydown', key: 'Enter' })
        this.sendInput({ type: 'keyup', key: 'Enter' })
      }
    })
    on(ime, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (this.composing) return
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(ev.key)) {
        ev.preventDefault()
        this.sendInput({ type: 'keydown', key: ev.key })
      }
    })
    on(ime, 'keyup', (e) => {
      const ev = e as KeyboardEvent
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(ev.key)) {
        this.sendInput({ type: 'keyup', key: ev.key })
      }
    })
  }

  unbind() {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    this.elements = null
    this.pressedMouseButtons.clear()
    this.activeTouches.clear()
  }

  goBack() { this.sendInput({ type: 'goback' }) }
  goForward() { this.sendInput({ type: 'goforward' }) }

  /** Test seam: emit a raw payload. */
  sendRawForTests(obj: Record<string, unknown>) {
    this.sendInput(obj)
  }

  private classifyPointer(ev: PointerEvent): 'touch' | 'mouse' {
    const type = ev.pointerType || 'mouse'
    if (type === 'touch') return 'touch'
    // Pen on a touch-primary device maps to touch so we do not drive remote hover.
    if (type === 'pen' && this.deps.isTouchPrimary?.()) return 'touch'
    return 'mouse'
  }

  private shouldIgnoreMouse(): boolean {
    if (this.activeTouches.size > 0) return true
    if (performance.now() < this.suppressMouseUntil) return true
    return false
  }

  private trackTouch(ev: PointerEvent): ActiveTouch {
    const touch: ActiveTouch = {
      pointerId: ev.pointerId,
      clientX: ev.clientX,
      clientY: ev.clientY,
      radiusX: Number.isFinite(ev.width) ? Math.max(1, ev.width / 2) : 1,
      radiusY: Number.isFinite(ev.height) ? Math.max(1, ev.height / 2) : 1,
      force: Number.isFinite(ev.pressure) ? ev.pressure : 0.5,
    }
    this.activeTouches.set(ev.pointerId, touch)
    return touch
  }

  private emitTouch(phase: TouchPhase, changedIds: number[]) {
    const points: TouchPointWire[] = [...this.activeTouches.values()].map((p) => {
      const { x, y } = this.pageCoords(p.clientX, p.clientY)
      return {
        id: p.pointerId,
        x,
        y,
        radiusX: p.radiusX,
        radiusY: p.radiusY,
        force: p.force,
      }
    })

    // CDP touchEnd/Cancel require empty touchPoints; remaining contacts are carried
    // on the wire so the sidecar can re-assert them after the empty end/cancel.
    let wirePoints = points
    if (phase === 'end' || phase === 'cancel') {
      wirePoints = points.filter((p) => !changedIds.includes(p.id))
    }

    this.sendInput(buildTouchPayload(phase, wirePoints, changedIds))
  }

  private sendInput(obj: Record<string, unknown>) {
    if (!this.userInputSubject) return
    this.userInputSubject.next(JSON.stringify(obj))
  }

  private pageCoords(clientX: number, clientY: number) {
    if (!this.elements) return { x: 0, y: 0 }
    const { w, h } = this.deps.getSessionSize()
    if (!this.cachedRect) this.cachedRect = this.elements.canvas.getBoundingClientRect()
    return canvasToPageCoords(clientX, clientY, this.cachedRect, w, h)
  }
}
