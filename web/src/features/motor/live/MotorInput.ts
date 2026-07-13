import type * as signalR from '@microsoft/signalr'
import type { MotorElements } from './types'

export type UserInputSubject = signalR.Subject<string>

export interface MotorInputDeps {
  getConnection: () => signalR.HubConnection | null
  getSessionSize: () => { w: number; h: number }
  getCurrentUrl: () => string
}

export class MotorInput {
  private heldKeys = new Set<string>()
  private pressedBtns = new Set<number>()
  private cachedRect: DOMRect | null = null
  private lastMoveTime = 0
  private cleanupFns: Array<() => void> = []
  private userInputSubject: UserInputSubject | null = null
  private elements: MotorElements | null = null
  private deps: MotorInputDeps

  constructor(deps: MotorInputDeps) {
    this.deps = deps
  }

  setUserInputSubject(subject: UserInputSubject | null) {
    this.userInputSubject = subject
  }

  clearPointerState() {
    this.heldKeys.clear()
    this.pressedBtns.clear()
  }

  invalidateRect() {
    this.cachedRect = null
  }

  bind(elements: MotorElements) {
    this.unbind()
    this.elements = elements
    const { canvas, urlBar } = elements

    const on = (el: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, opts)
      this.cleanupFns.push(() => el.removeEventListener(type, fn, opts))
    }

    on(canvas, 'mousemove', (e) => {
      const ev = e as MouseEvent
      const now = performance.now()
      if (now - this.lastMoveTime < 16) return
      this.lastMoveTime = now
      const { x, y } = this.canvasToPage(ev.clientX, ev.clientY)
      this.sendInput({ type: 'mousemove', x, y })
    })

    on(canvas, 'mousedown', (e) => {
      const ev = e as MouseEvent
      ev.preventDefault()
      canvas.focus()
      this.pressedBtns.add(ev.button)
      const { x, y } = this.canvasToPage(ev.clientX, ev.clientY)
      this.sendInput({ type: 'mousedown', x, y, button: ev.button })
    })

    on(window, 'mouseup', (e) => {
      const ev = e as MouseEvent
      if (!this.pressedBtns.has(ev.button)) return
      this.pressedBtns.delete(ev.button)
      const { x, y } = this.canvasToPage(ev.clientX, ev.clientY)
      this.sendInput({ type: 'mouseup', x, y, button: ev.button })
    })

    on(window, 'mousemove', (e) => {
      if (this.pressedBtns.size === 0) return
      const ev = e as MouseEvent
      const now = performance.now()
      if (now - this.lastMoveTime < 16) return
      this.lastMoveTime = now
      const { x, y } = this.canvasToPage(ev.clientX, ev.clientY)
      this.sendInput({ type: 'mousemove', x, y })
    })

    on(canvas, 'contextmenu', (e) => (e as Event).preventDefault())

    on(canvas, 'touchstart', (e) => {
      const ev = e as TouchEvent
      ev.preventDefault()
      canvas.focus()
      const t = ev.changedTouches[0]
      if (!t) return
      const { x, y } = this.canvasToPage(t.clientX, t.clientY)
      this.sendInput({ type: 'mousedown', x, y, button: 0 })
    }, { passive: false })

    on(canvas, 'touchmove', (e) => {
      const ev = e as TouchEvent
      ev.preventDefault()
      const t = ev.touches[0]
      if (!t) return
      const now = performance.now()
      if (now - this.lastMoveTime < 16) return
      this.lastMoveTime = now
      const { x, y } = this.canvasToPage(t.clientX, t.clientY)
      this.sendInput({ type: 'mousemove', x, y })
    }, { passive: false })

    const endTouch = (e: Event) => {
      const ev = e as TouchEvent
      ev.preventDefault()
      const t = ev.changedTouches[0]
      if (!t) return
      const { x, y } = this.canvasToPage(t.clientX, t.clientY)
      this.sendInput({ type: 'mouseup', x, y, button: 0 })
    }
    on(canvas, 'touchend', endTouch, { passive: false })
    on(canvas, 'touchcancel', endTouch, { passive: false })
    on(canvas, 'wheel', (e) => {
      const ev = e as WheelEvent
      ev.preventDefault()
      const { x, y } = this.canvasToPage(ev.clientX, ev.clientY)
      let dX = ev.deltaX
      let dY = ev.deltaY
      if (ev.deltaMode === 1) { dX *= 40; dY *= 40 }
      else if (ev.deltaMode === 2) { dX *= canvas.clientWidth; dY *= canvas.clientHeight }
      this.sendInput({ type: 'wheel', x, y, deltaX: dX, deltaY: dY })
    }, { passive: false })

    canvas.setAttribute('tabindex', '0')
    on(canvas, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (ev.key === 'F12') return
      if ((ev.ctrlKey || ev.metaKey) && ['r', 'l', 't', 'w', 'n'].includes(ev.key.toLowerCase())) return
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
  }

  unbind() {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    this.elements = null
  }

  goBack() { this.sendInput({ type: 'goback' }) }
  goForward() { this.sendInput({ type: 'goforward' }) }

  private sendInput(obj: Record<string, unknown>) {
    if (!this.userInputSubject) return
    this.userInputSubject.next(JSON.stringify(obj))
  }

  private canvasToPage(clientX: number, clientY: number) {
    if (!this.elements) return { x: 0, y: 0 }
    const { w, h } = this.deps.getSessionSize()
    if (!this.cachedRect) this.cachedRect = this.elements.canvas.getBoundingClientRect()
    return {
      x: Math.round((clientX - this.cachedRect.left) * (w / this.cachedRect.width)),
      y: Math.round((clientY - this.cachedRect.top) * (h / this.cachedRect.height)),
    }
  }
}
