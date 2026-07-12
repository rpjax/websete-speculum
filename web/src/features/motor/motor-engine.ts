import * as signalR from '@microsoft/signalr'
import * as msgpack from '@microsoft/signalr-protocol-msgpack'
import { API_URL } from '@/lib/env'
import { fetchClientConfig, loadClientToken, saveClientToken, type ClientConfig } from '@/lib/session-id'
import { mapTargetToClientUrl, syncClientLocation } from '@/lib/host-mapper'
import FrameWorker from './frame-decode.worker?worker'

const MSG_URL = 0x04
const MSG_CONSOLE = 0x05
const MSG_EVAL_RESULT = 0x06
const MSG_REDIRECT = 0x0a
const VCON_METHODS = ['log', 'warn', 'error', 'info', 'debug'] as const

function isSetupRequiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /não configurado|not configured|Motor não configurado/i.test(msg)
}

export type MotorStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface MotorUiState {
  status: MotorStatus
  statusText: string
  showOverlay: boolean
  url: string
  fps: number | null
  navDisabled: boolean
}

interface FramePayload {
  jpeg: Uint8Array | number[]
  sequence?: number
}

interface ConsoleOutputPayload {
  data: Uint8Array | ArrayBuffer | number[] | string
}

interface SessionStatusPayload {
  tabCount: number
  url: string
  resizing: boolean
  width: number
  height: number
  fps: number
  uptimeMs: number
  sessionId: string
  jsBridgeEnabled: boolean
}

interface MotorElements {
  canvas: HTMLCanvasElement
  viewport: HTMLDivElement
  urlBar: HTMLInputElement
}

type StateListener = (state: MotorUiState) => void

export class MotorEngine {
  private connection: signalR.HubConnection | null = null
  private connecting = false
  private frameWorker: Worker | null = null
  private latestDrawnSeq = 0
  private userInputSubject: signalR.Subject<string> | null = null
  private consoleInputSubject: signalR.Subject<{ id: number; code: string }> | null = null
  private sessionW = 1280
  private sessionH = 720
  private currentUrl = ''
  private jsBridgeEnabled = false
  private evalId = 0
  private evalPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private heldKeys = new Set<string>()
  private pressedBtns = new Set<number>()
  private cachedRect: DOMRect | null = null
  private lastMoveTime = 0
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private resizeObserver: ResizeObserver | null = null
  private fpsFrames = 0
  private fpsLastTs = performance.now()
  private listeners = new Set<StateListener>()
  private cleanupFns: Array<() => void> = []
  private streamDisposers: Array<() => void> = []
  private elements: MotorElements | null = null
  private mounted = false
  private clientConfig: ClientConfig | null = null

  private state: MotorUiState = {
    status: 'idle',
    statusText: 'Disconnected',
    showOverlay: true,
    url: '',
    fps: null,
    navDisabled: true,
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  private emit(partial: Partial<MotorUiState>) {
    this.state = { ...this.state, ...partial }
    for (const l of this.listeners) l(this.state)
  }

  mount(elements: MotorElements) {
    this.mounted = true
    this.elements = elements
    this.bindInput(elements)
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      if (w < 100 || h < 100) return
      if (w === this.sessionW && h === this.sessionH) return
      this.invalidateRect()
      if (this.resizeTimer) clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(async () => {
        this.syncCanvasSize(w, h)
        if (this.connection) {
          try { await this.connection.invoke('ResizeAsync', w, h) } catch { /* ignore */ }
        }
      }, 250)
    })
    this.resizeObserver.observe(elements.viewport)
    void this.connect()
  }

  unmount() {
    this.mounted = false
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    void this.stopConnection()
    this.elements = null
  }

  private isActive(): boolean {
    return this.mounted && this.elements !== null
  }

  async connect() {
    if (this.connecting || !this.isActive()) return
    this.connecting = true
    this.emit({ status: 'connecting', statusText: 'Connecting...', showOverlay: true })

    try {
      const readyRes = await fetch(`${API_URL}/ready`, { credentials: 'include' })
      if (!this.isActive()) return
      if (!readyRes.ok) {
        window.location.replace('/setup')
        return
      }
      this.clientConfig = await fetchClientConfig(API_URL)
    } catch {
      if (!this.isActive()) return
      this.emit({ status: 'error', statusText: 'Error: cannot reach server', showOverlay: true })
      this.connecting = false
      return
    }

    await this.stopConnection()
    if (!this.isActive()) return

    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${API_URL}/vhub`, {
        withCredentials: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withHubProtocol(new msgpack.MessagePackHubProtocol())
      .withAutomaticReconnect()
      .build()

    this.connection.onclose(() => this.onDisconnected())
    this.connection.onreconnecting(() => this.emit({ status: 'connecting', statusText: 'Reconnecting...' }))
    this.connection.onreconnected(async () => {
      try {
        await this.bootstrapSession()
      } catch (err) {
        console.error('[reconnect]', err)
        await this.stopConnection()
        this.emit({
          status: 'error',
          statusText: 'Reconnect failed — click to retry',
          showOverlay: true,
          navDisabled: true,
        })
      }
    })

    try {
      await this.connection.start()
      if (!this.isActive()) {
        await this.stopConnection()
        return
      }
      await this.bootstrapSession()
    } catch (err) {
      console.error('[connect]', err)
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ status: 'error', statusText: `Error: ${message}`, showOverlay: true })
      await this.stopConnection()
    } finally {
      this.connecting = false
    }
  }

  private teardownHubChannels() {
    for (const dispose of this.streamDisposers) {
      try { dispose() } catch { /* ignore */ }
    }
    this.streamDisposers = []

    if (this.userInputSubject) {
      try { this.userInputSubject.complete() } catch { /* ignore */ }
      this.userInputSubject = null
    }
    if (this.consoleInputSubject) {
      try { this.consoleInputSubject.complete() } catch { /* ignore */ }
      this.consoleInputSubject = null
    }
  }

  private subscribeStream<T>(
    method: string,
    handlers: {
      next: (value: T) => void
      error: (err: unknown) => void
      complete: () => void
    },
  ) {
    if (!this.connection) return
    const sub = this.connection.stream(method).subscribe(handlers)
    this.streamDisposers.push(() => sub.dispose())
  }

  private async bootstrapSession() {
    const elements = this.elements
    if (!this.isActive() || !this.connection || !elements) return
    this.teardownHubChannels()

    const initW = elements.viewport.clientWidth || 1280
    const initH = elements.viewport.clientHeight || 720
    this.syncCanvasSize(initW, initH)

    const clientToken = await this.invokeStartSession(initW, initH)
    if (!clientToken) {
      await this.stopConnection()
      return
    }
    if (this.clientConfig) saveClientToken(clientToken, this.clientConfig)

    this.subscribeStream<FramePayload>('OpenFrameChannel', {
      next: (frame) => this.onFrame(frame),
      error: (err) => console.error('[frame stream]', err),
      complete: () => {},
    })

    this.subscribeStream<ConsoleOutputPayload>('OpenConsoleOutputChannel', {
      next: (output) => this.onConsoleOutput(output),
      error: (err) => console.error('[console stream]', err),
      complete: () => {},
    })

    this.subscribeStream<SessionStatusPayload>('OpenStatusChannel', {
      next: (status) => this.onSessionStatus(status),
      error: (err) => console.warn('[status stream]', err),
      complete: () => {},
    })

    this.userInputSubject = new signalR.Subject()
    this.consoleInputSubject = new signalR.Subject()
    this.connection.send('OpenUserInputChannel', this.userInputSubject)
    this.connection.send('OpenConsoleInputChannel', this.consoleInputSubject)

    this.emit({
      status: 'connected',
      statusText: 'Streaming',
      showOverlay: false,
      navDisabled: false,
      url: this.currentUrl,
    })
    elements.canvas.focus()
  }

  private async invokeStartSession(initW: number, initH: number): Promise<string | null> {
    if (!this.connection) return null
    try {
      return await this.connection.invoke<string>(
        'StartSessionAsync',
        window.location.href,
        initW,
        initH,
        loadClientToken(this.clientConfig!),
      )
    } catch (err) {
      if (isSetupRequiredError(err)) {
        window.location.replace('/setup')
        return null
      }
      throw err
    }
  }

  private onDisconnected() {
    this.emit({
      status: 'error',
      statusText: 'Disconnected — click to reconnect',
      showOverlay: true,
      navDisabled: true,
      url: '',
    })
    this.heldKeys.clear()
    this.pressedBtns.clear()
    this.teardownFrameWorker()
    this.uninstallVcon()
    this.teardownHubChannels()
    this.connection = null
    this.connecting = false
  }

  private async stopConnection() {
    this.teardownFrameWorker()
    this.uninstallVcon()
    for (const { reject, timer } of this.evalPending.values()) {
      clearTimeout(timer)
      reject(new Error('[vcon] Session closed'))
    }
    this.evalPending.clear()
    this.teardownHubChannels()
    if (this.connection) {
      try { await this.connection.stop() } catch { /* ignore */ }
      this.connection = null
    }
  }

  private syncCanvasSize(w: number, h: number) {
    if (!this.elements) return
    this.sessionW = w
    this.sessionH = h
    this.elements.canvas.width = w
    this.elements.canvas.height = h
    this.invalidateRect()
  }

  private ensureFrameWorker() {
    if (this.frameWorker || !this.elements) return
    this.frameWorker = new FrameWorker()
    const ctx = this.elements.canvas.getContext('2d')
    if (!ctx) return
    this.frameWorker.onmessage = (ev: MessageEvent<{ seq: number; bitmap?: ImageBitmap; error?: string }>) => {
      const { seq, bitmap, error } = ev.data
      if (error) {
        console.warn('[frame] JPEG decode error', error)
        return
      }
      if (!bitmap || seq < this.latestDrawnSeq) {
        bitmap?.close()
        return
      }
      this.latestDrawnSeq = seq
      ctx.drawImage(bitmap, 0, 0, this.elements!.canvas.width, this.elements!.canvas.height)
      bitmap.close()
      this.tickFps()
    }
  }

  private teardownFrameWorker() {
    this.frameWorker?.terminate()
    this.frameWorker = null
    this.latestDrawnSeq = 0
  }

  private tickFps() {
    const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.endsWith('.localhost')
    if (!isDev) return
    this.fpsFrames++
    const now = performance.now()
    const elapsed = now - this.fpsLastTs
    if (elapsed >= 1000) {
      const fps = Math.round(this.fpsFrames * 1000 / elapsed)
      this.emit({ fps })
      this.fpsFrames = 0
      this.fpsLastTs = now
    }
  }

  private onFrame(frame: FramePayload) {
    const raw = frame as FramePayload & { Jpeg?: Uint8Array | number[] }
    const jpeg = frame?.jpeg ?? raw.Jpeg
    if (!jpeg?.length || !this.elements) return
    const seq = frame.sequence ?? 0
    if (seq < this.latestDrawnSeq) return
    this.ensureFrameWorker()
    const buf = jpeg instanceof Uint8Array
      ? jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength)
      : new Uint8Array(jpeg).buffer
    this.frameWorker?.postMessage({ seq, jpeg: buf }, [buf])
  }

  private wireToU8(data: ConsoleOutputPayload['data']) {
    if (data instanceof Uint8Array) return data
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
    if (Array.isArray(data)) return new Uint8Array(data)
    if (typeof data === 'string') {
      const bin = atob(data)
      const u8 = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      return u8
    }
    return new Uint8Array(0)
  }

  private onConsoleOutput(output: ConsoleOutputPayload) {
    if (!this.elements) return
    const bytes = this.wireToU8(output.data)
    if (bytes.length < 1) return
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const type = bytes[0]

    if (type === MSG_URL) {
      if (bytes.length < 5) return
      const len = view.getUint32(1, true)
      const targetUrl = new TextDecoder().decode(bytes.slice(5, 5 + len))
      const mapped = this.clientConfig
        ? mapTargetToClientUrl(targetUrl, this.clientConfig)
        : targetUrl
      this.currentUrl = mapped
      if (document.activeElement !== this.elements.urlBar) {
        this.elements.urlBar.value = mapped
        this.emit({ url: mapped })
      }
      syncClientLocation(mapped)
    } else if (type === MSG_CONSOLE) {
      if (bytes.length < 6) return
      const level = bytes[1]
      const len = view.getUint32(2, true)
      const text = new TextDecoder().decode(bytes.slice(6, 6 + len))
      const fn = console[VCON_METHODS[level] ?? 'log'] as (...args: unknown[]) => void
      fn.call(console, '%c[VCON]%c ' + text, 'color:#ff9800;font-weight:bold;font-family:monospace', 'color:inherit;font-family:monospace')
    } else if (type === MSG_EVAL_RESULT) {
      if (bytes.length < 10) return
      const id = view.getUint32(1, true)
      const ok = bytes[5] === 1
      const len = view.getUint32(6, true)
      const value = new TextDecoder().decode(bytes.slice(10, 10 + len))
      const p = this.evalPending.get(id)
      if (!p) return
      clearTimeout(p.timer)
      this.evalPending.delete(id)
      if (ok) {
        let parsed: unknown
        try { parsed = JSON.parse(value) } catch { parsed = value }
        p.resolve(parsed)
      } else {
        p.reject(new Error(value))
      }
    } else if (type === MSG_REDIRECT) {
      if (bytes.length < 5) return
      const len = view.getUint32(1, true)
      const redirectUrl = new TextDecoder().decode(bytes.slice(5, 5 + len))
      window.location.href = redirectUrl
    }
  }

  private onSessionStatus(s: SessionStatusPayload) {
    this.jsBridgeEnabled = !!s.jsBridgeEnabled
    if (this.jsBridgeEnabled && this.connection) this.installVcon()
    else if (!this.jsBridgeEnabled) this.uninstallVcon()

    if (s.url && this.elements && document.activeElement !== this.elements.urlBar) {
      const mapped = this.clientConfig
        ? mapTargetToClientUrl(s.url, this.clientConfig)
        : s.url
      this.currentUrl = mapped
      this.elements.urlBar.value = mapped
      this.emit({ url: mapped })
    }
  }

  private installVcon() {
    if (!this.jsBridgeEnabled) {
      this.uninstallVcon()
      return
    }
    ;(window as Window & { vcon?: (code: string) => Promise<unknown> }).vcon = (code: string) =>
      new Promise((resolve, reject) => {
        if (!this.consoleInputSubject) {
          reject(new Error('[vcon] No active session'))
          return
        }
        const id = ++this.evalId
        const timer = setTimeout(() => {
          this.evalPending.delete(id)
          reject(new Error('[vcon] Timed out after 10 s'))
        }, 10_000)
        this.evalPending.set(id, { resolve, reject, timer })
        this.consoleInputSubject.next({ id, code })
      })
  }

  private uninstallVcon() {
    delete (window as Window & { vcon?: (code: string) => Promise<unknown> }).vcon
  }

  private sendInput(obj: Record<string, unknown>) {
    if (!this.userInputSubject) return
    this.userInputSubject.next(JSON.stringify(obj))
  }

  private invalidateRect() {
    this.cachedRect = null
  }

  private canvasToPage(clientX: number, clientY: number) {
    if (!this.elements) return { x: 0, y: 0 }
    if (!this.cachedRect) this.cachedRect = this.elements.canvas.getBoundingClientRect()
    return {
      x: Math.round((clientX - this.cachedRect.left) * (this.sessionW / this.cachedRect.width)),
      y: Math.round((clientY - this.cachedRect.top) * (this.sessionH / this.cachedRect.height)),
    }
  }

  private bindInput({ canvas, urlBar }: MotorElements) {
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
        if (!raw) { urlBar.value = this.currentUrl; return }
        const target = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
        urlBar.value = target
        urlBar.blur()
        canvas.focus()
        this.connection?.invoke('NavigateAsync', target).catch(console.error)
      } else if (ev.key === 'Escape') {
        urlBar.value = this.currentUrl
        urlBar.blur()
        canvas.focus()
      }
      ev.stopPropagation()
    })
    on(urlBar, 'blur', () => { urlBar.value = this.currentUrl })
    on(urlBar, 'focus', () => urlBar.select())
  }

  goBack() { this.sendInput({ type: 'goback' }) }
  goForward() { this.sendInput({ type: 'goforward' }) }
}
