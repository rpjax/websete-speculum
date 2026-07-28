import type { SessionInput, TouchPointInput } from '@/lib/speculum'
import {
  clientToFramePointFill,
  isLocalBrowserShortcut,
  normalizeWheelDeltas,
  shouldThrottleMove,
} from './sessionCoords'

export interface SessionInputControllerDeps {
  getFrameSize: () => { width: number; height: number }
  onInput: (input: SessionInput) => void
  onImeFocusChange?: (focused: boolean) => void
  /**
   * Touch-primary session (mobile / coarse): suppress hover mouse and map pen→touch.
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
  /** Last successful map — kept if a sample fails (edge clamp / transient). */
  lastMapped: { x: number; y: number }
}

const MOUSE_SUPPRESS_AFTER_TOUCH_MS = 600

/** Keys forwarded from the IME shell (beforeinput does not cover caret/nav). */
const IME_NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Tab',
  'Escape',
])

/**
 * Pointer/keyboard/wheel/IME capture bound to the session canvas.
 * Coordinates use object-fill 1:1 mapping ({@link clientToFramePointFill}) —
 * CSS layout host is authoritative; remote frame matches after canvas sync.
 */
export class SessionInputController {
  private heldKeys = new Set<string>()
  private pressedMouseButtons = new Set<number>()
  private activeTouches = new Map<number, ActiveTouch>()
  private lastMousePage = { x: 0, y: 0 }
  private cachedRect: DOMRect | null = null
  private lastTouchMoveTime = 0
  private lastMouseMoveTime = 0
  private suppressMouseUntil = 0
  private cleanupFns: Array<() => void> = []
  private canvas: HTMLCanvasElement | null = null
  private imeEl: HTMLTextAreaElement | null = null
  private composing = false
  /** Set by beforeinput so keydown does not double-send Backspace/Enter/Delete. */
  private imeBeforeInputHandled = false
  private enabled = false
  private readonly deps: SessionInputControllerDeps

  constructor(deps: SessionInputControllerDeps) {
    this.deps = deps
  }

  setEnabled(enabled: boolean) {
    if (!enabled && this.enabled) {
      this.releaseAllPointers()
      this.composing = false
      this.imeBeforeInputHandled = false
    }
    this.enabled = enabled
  }

  invalidateRect() {
    this.cachedRect = null
  }

  setFrameSize(_width: number, _height: number) {
    this.invalidateRect()
  }

  focusIme() {
    this.imeEl?.focus({ preventScroll: true })
  }

  blurIme() {
    this.imeEl?.blur()
  }

  isImeFocused(): boolean {
    return !!this.imeEl && document.activeElement === this.imeEl
  }

  bind(canvas: HTMLCanvasElement, ime: HTMLTextAreaElement | null) {
    this.unbind()
    this.canvas = canvas
    this.imeEl = ime

    const on = (
      el: EventTarget,
      type: string,
      fn: EventListener,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn, opts)
      this.cleanupFns.push(() => el.removeEventListener(type, fn, opts))
    }

    on(canvas, 'pointerdown', (e) => {
      if (!this.enabled) return
      const ev = e as PointerEvent
      this.invalidateRect()
      const kind = this.classifyPointer(ev)

      if (kind === 'mouse') {
        if (this.shouldIgnoreMouse()) return
        if (ev.button !== 0 && ev.button !== 1 && ev.button !== 2) return
        const point = this.framePoint(ev.clientX, ev.clientY)
        if (!point) return
        ev.preventDefault()
        // Keep OS keyboard open when the IME shell already owns focus (editing taps).
        if (!this.isImeFocused()) {
          canvas.focus({ preventScroll: true })
        }
        try {
          canvas.setPointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        this.pressedMouseButtons.add(ev.button)
        this.lastMousePage = point
        this.send({ type: 'mousedown', x: point.x, y: point.y, button: ev.button })
        return
      }

      const point = this.framePoint(ev.clientX, ev.clientY)
      if (!point) return
      ev.preventDefault()
      if (!this.isImeFocused()) {
        canvas.focus({ preventScroll: true })
      }
      try {
        canvas.setPointerCapture(ev.pointerId)
      } catch {
        /* ignore */
      }
      this.suppressMouseUntil = performance.now() + MOUSE_SUPPRESS_AFTER_TOUCH_MS
      this.trackTouch(ev)
      // Ensure lastMapped is the start hit (trackTouch may have raced null).
      const touch = this.activeTouches.get(ev.pointerId)
      if (touch) touch.lastMapped = point
      this.emitTouch('start', [ev.pointerId])
    })

    on(canvas, 'pointermove', (e) => {
      if (!this.enabled) return
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

      const touchPrimary = !!this.deps.isTouchPrimary?.()
      const dragging = this.pressedMouseButtons.size > 0 || (ev.buttons ?? 0) !== 0
      if (touchPrimary && !dragging) return

      const now = performance.now()
      if (shouldThrottleMove(now, this.lastMouseMoveTime)) return
      this.lastMouseMoveTime = now
      const point = this.framePoint(ev.clientX, ev.clientY)
      if (!point) return
      this.lastMousePage = point
      this.send({ type: 'mousemove', x: point.x, y: point.y })
    })

    const endPointer = (phase: 'end' | 'cancel') => (e: Event) => {
      if (!this.enabled && this.pressedMouseButtons.size === 0 && this.activeTouches.size === 0) {
        return
      }
      const ev = e as PointerEvent
      const kind = this.classifyPointer(ev)

      if (kind === 'touch' || this.activeTouches.has(ev.pointerId)) {
        if (!this.activeTouches.has(ev.pointerId)) return
        ev.preventDefault()
        this.trackTouch(ev)
        // force when disabled so a late pointerup after stop still lifts remote contacts.
        this.emitTouch(phase, [ev.pointerId], !this.enabled)
        this.activeTouches.delete(ev.pointerId)
        this.suppressMouseUntil = performance.now() + MOUSE_SUPPRESS_AFTER_TOUCH_MS
        try {
          canvas.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        return
      }

      // Do not apply touch→mouse suppress here: a tracked button must always
      // release, or a chord overlapping a touch leaves the remote button stuck.

      if (phase === 'cancel') {
        if (this.pressedMouseButtons.size === 0) return
        ev.preventDefault()
        const point = this.framePoint(ev.clientX, ev.clientY) ?? this.lastMousePage
        this.lastMousePage = point
        for (const button of [...this.pressedMouseButtons]) {
          this.send({ type: 'mouseup', x: point.x, y: point.y, button }, true)
        }
        this.pressedMouseButtons.clear()
        try {
          canvas.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        return
      }

      if (!this.pressedMouseButtons.has(ev.button)) return
      ev.preventDefault()
      this.pressedMouseButtons.delete(ev.button)
      const point = this.framePoint(ev.clientX, ev.clientY) ?? this.lastMousePage
      this.lastMousePage = point
      this.send({ type: 'mouseup', x: point.x, y: point.y, button: ev.button }, true)
      if (this.pressedMouseButtons.size === 0) {
        try {
          canvas.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
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
        this.emitTouch('cancel', [ev.pointerId], !this.enabled)
        this.activeTouches.delete(ev.pointerId)
        this.suppressMouseUntil = performance.now() + MOUSE_SUPPRESS_AFTER_TOUCH_MS
        return
      }
      if (this.pressedMouseButtons.size === 0) return
      const { x, y } = this.lastMousePage
      for (const button of [...this.pressedMouseButtons]) {
        this.send({ type: 'mouseup', x, y, button }, true)
      }
      this.pressedMouseButtons.clear()
    })

    on(canvas, 'contextmenu', (e) => (e as Event).preventDefault())

    on(
      canvas,
      'wheel',
      (e) => {
        if (!this.enabled) return
        const ev = e as WheelEvent
        ev.preventDefault()
        this.invalidateRect()
        const point = this.framePoint(ev.clientX, ev.clientY)
        if (!point) return
        const { width, height } = this.deps.getFrameSize()
        const deltas = normalizeWheelDeltas(
          ev.deltaX,
          ev.deltaY,
          ev.deltaMode,
          width,
          height,
        )
        this.send({
          type: 'wheel',
          x: point.x,
          y: point.y,
          deltaX: deltas.deltaX,
          deltaY: deltas.deltaY,
        })
      },
      { passive: false },
    )

    canvas.setAttribute('tabindex', '0')
    on(canvas, 'keydown', (e) => {
      if (!this.enabled) return
      const ev = e as KeyboardEvent
      if (isLocalBrowserShortcut(ev.key, ev.ctrlKey || ev.metaKey)) return
      // Yield only when the IME shell owns focus — not on stale EditableFocus flags
      // (poll lag can keep editing=true after the canvas already took focus).
      if (this.isImeFocused()) return
      ev.preventDefault()
      this.heldKeys.add(ev.key)
      this.send({ type: 'keydown', key: ev.key })
    })
    on(canvas, 'keyup', (e) => {
      if (!this.enabled) return
      const ev = e as KeyboardEvent
      if (!this.heldKeys.has(ev.key)) return
      this.heldKeys.delete(ev.key)
      this.send({ type: 'keyup', key: ev.key })
    })
    on(canvas, 'blur', () => {
      for (const key of this.heldKeys) {
        this.send({ type: 'keyup', key }, true)
      }
      this.heldKeys.clear()
      if (this.pressedMouseButtons.size === 0) return
      const { x, y } = this.lastMousePage
      for (const button of [...this.pressedMouseButtons]) {
        this.send({ type: 'mouseup', x, y, button }, true)
      }
      this.pressedMouseButtons.clear()
    })

    if (ime) {
      this.bindIme(ime, on)
    }
  }

  unbind() {
    // Always release remote gestures (force) — even if already disabled — so a
    // mid-drag unmount cannot leave Chromium with stuck buttons/touches.
    this.releaseAllPointers()
    this.composing = false
    this.imeBeforeInputHandled = false
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    this.canvas = null
    this.imeEl = null
    this.pressedMouseButtons.clear()
    this.activeTouches.clear()
    this.heldKeys.clear()
  }

  private bindIme(
    ime: HTMLTextAreaElement,
    on: (
      el: EventTarget,
      type: string,
      fn: EventListener,
      opts?: AddEventListenerOptions,
    ) => void,
  ) {
    on(ime, 'focus', () => {
      this.invalidateRect()
      this.deps.onImeFocusChange?.(true)
    })
    on(ime, 'blur', () => {
      this.invalidateRect()
      this.deps.onImeFocusChange?.(false)
    })
    on(ime, 'compositionstart', () => {
      this.composing = true
    })
    on(ime, 'compositionend', (e) => {
      this.composing = false
      const data = (e as CompositionEvent).data
      if (data) this.send({ type: 'text', text: data, source: 'composition' })
      ime.value = ''
    })
    on(ime, 'beforeinput', (e) => {
      const ev = e as InputEvent
      if (this.composing) return
      if (ev.inputType === 'insertText' && ev.data) {
        ev.preventDefault()
        this.imeBeforeInputHandled = true
        this.send({ type: 'text', text: ev.data, source: 'insert' })
        ime.value = ''
      } else if (ev.inputType === 'insertCompositionText') {
        // wait for compositionend
      } else if (ev.inputType === 'deleteContentBackward') {
        ev.preventDefault()
        this.imeBeforeInputHandled = true
        this.send({ type: 'keydown', key: 'Backspace' })
        this.send({ type: 'keyup', key: 'Backspace' })
      } else if (ev.inputType === 'deleteContentForward') {
        ev.preventDefault()
        this.imeBeforeInputHandled = true
        this.send({ type: 'keydown', key: 'Delete' })
        this.send({ type: 'keyup', key: 'Delete' })
      } else if (ev.inputType === 'insertLineBreak' || ev.inputType === 'insertParagraph') {
        ev.preventDefault()
        this.imeBeforeInputHandled = true
        this.send({ type: 'keydown', key: 'Enter' })
        this.send({ type: 'keyup', key: 'Enter' })
      }
    })
    on(ime, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (this.composing) return
      if (IME_NAV_KEYS.has(ev.key)) {
        ev.preventDefault()
        this.send({ type: 'keydown', key: ev.key })
        return
      }
      // Fallback when the engine skips beforeinput (some mobile keyboards).
      if (ev.key === 'Backspace' || ev.key === 'Enter' || ev.key === 'Delete') {
        if (this.imeBeforeInputHandled) {
          this.imeBeforeInputHandled = false
          return
        }
        ev.preventDefault()
        this.send({ type: 'keydown', key: ev.key })
        this.send({ type: 'keyup', key: ev.key })
      }
    })
    on(ime, 'keyup', (e) => {
      const ev = e as KeyboardEvent
      if (IME_NAV_KEYS.has(ev.key)) {
        this.send({ type: 'keyup', key: ev.key })
      }
    })
  }

  private releaseAllPointers() {
    if (this.pressedMouseButtons.size > 0) {
      const { x, y } = this.lastMousePage
      for (const button of [...this.pressedMouseButtons]) {
        this.send({ type: 'mouseup', x, y, button }, true)
      }
      this.pressedMouseButtons.clear()
    }
    if (this.activeTouches.size > 0) {
      const ids = [...this.activeTouches.keys()]
      this.emitTouch('cancel', ids, true)
      this.activeTouches.clear()
    }
    for (const key of this.heldKeys) {
      this.send({ type: 'keyup', key }, true)
    }
    this.heldKeys.clear()
  }

  private classifyPointer(ev: PointerEvent): 'touch' | 'mouse' {
    // Touch-primary sessions (phone UA / coarse+no-hover, including DevTools device
    // mode): Chromium has no hover mouse — map every pointer to touch so clicks from
    // a desktop mouse still reach the page instead of being dropped by the sidecar.
    if (this.deps.isTouchPrimary?.()) {
      return 'touch'
    }
    const type = ev.pointerType || 'mouse'
    if (type === 'touch') return 'touch'
    return 'mouse'
  }

  private shouldIgnoreMouse(): boolean {
    if (this.activeTouches.size > 0) return true
    if (performance.now() < this.suppressMouseUntil) return true
    return false
  }

  private trackTouch(ev: PointerEvent): ActiveTouch {
    const mapped = this.framePoint(ev.clientX, ev.clientY)
    const existing = this.activeTouches.get(ev.pointerId)
    const lastMapped = mapped ?? existing?.lastMapped ?? { x: 0, y: 0 }
    const touch: ActiveTouch = {
      pointerId: ev.pointerId,
      clientX: ev.clientX,
      clientY: ev.clientY,
      radiusX: Number.isFinite(ev.width) ? Math.max(1, ev.width / 2) : 1,
      radiusY: Number.isFinite(ev.height) ? Math.max(1, ev.height / 2) : 1,
      force: Number.isFinite(ev.pressure) ? ev.pressure : 0.5,
      lastMapped,
    }
    this.activeTouches.set(ev.pointerId, touch)
    return touch
  }

  private emitTouch(
    phase: 'start' | 'move' | 'end' | 'cancel',
    changedIds: number[],
    force = false,
  ) {
    const points: TouchPointInput[] = []
    for (const p of this.activeTouches.values()) {
      const mapped = this.framePoint(p.clientX, p.clientY)
      if (mapped) {
        p.lastMapped = mapped
      }
      // Active contacts must stay on the wire even when the finger enters the
      // letterbox gutter — otherwise CDP treats them as lifted.
      const coords = mapped ?? p.lastMapped
      points.push({
        id: p.pointerId,
        x: coords.x,
        y: coords.y,
        radiusX: p.radiusX,
        radiusY: p.radiusY,
        force: p.force,
      })
    }

    // CDP touchEnd/Cancel require empty touchPoints; remaining contacts stay on
    // the wire so the sidecar can re-assert them after the empty end/cancel.
    let wirePoints = points
    if (phase === 'end' || phase === 'cancel') {
      wirePoints = points.filter((p) => !changedIds.includes(p.id))
    }

    this.send(
      {
        type: 'touch',
        phase,
        points: wirePoints,
        changedIds,
      },
      force,
    )
  }

  private framePoint(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.canvas) return null
    const { width, height } = this.deps.getFrameSize()
    if (!this.cachedRect) this.cachedRect = this.canvas.getBoundingClientRect()
    return clientToFramePointFill(clientX, clientY, this.cachedRect, width, height)
  }

  /** @param force — deliver release events even after setEnabled(false). */
  private send(input: SessionInput, force = false) {
    if (!this.enabled && !force) return
    this.deps.onInput(input)
  }
}
