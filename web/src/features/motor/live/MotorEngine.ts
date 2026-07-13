import { API_URL } from '@/lib/env'
import { fetchClientConfig, saveClientToken, type ClientConfig } from '@/lib/clientConfig'
import { syncClientLocation } from '@/features/motor/mapping/syncClientLocation'
import { MotorConnection } from './MotorConnection'
import { MotorScreencast } from './MotorScreencast'
import { MotorVcon } from './MotorVcon'
import { MotorInput } from './MotorInput'
import type {
  ConsoleOutputPayload,
  MotorElements,
  MotorUiState,
  SessionStatusPayload,
  StateListener,
} from './types'

export type { MotorStatus, MotorUiState } from './types'

export class MotorEngine {
  private connecting = false
  private sessionW = 1280
  private sessionH = 720
  private currentUrl = ''
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private resizeObserver: ResizeObserver | null = null
  private listeners = new Set<StateListener>()
  private elements: MotorElements | null = null
  private mounted = false
  private clientConfig: ClientConfig | null = null

  private screencast = new MotorScreencast()
  private vcon = new MotorVcon({
    onMappedUrl: (url) => this.applyMappedUrl(url),
    onRedirect: (url) => { window.location.href = url },
  })
  private input = new MotorInput({
    getConnection: () => this.connection.hub,
    getSessionSize: () => ({ w: this.sessionW, h: this.sessionH }),
    getCurrentUrl: () => this.currentUrl,
  })
  private connection = new MotorConnection({
    onFrame: (frame) => this.screencast.onFrame(frame),
    onConsoleOutput: (output) => this.onConsoleOutput(output),
    onSessionStatus: (status) => this.onSessionStatus(status),
    onDisconnected: () => this.onDisconnected(),
    onReconnecting: () => this.emit({ status: 'connecting', statusText: 'Reconnecting...' }),
    emitError: (message) => this.emit({
      status: 'error',
      statusText: message,
      showOverlay: true,
      navDisabled: true,
    }),
  })

  private state: MotorUiState = {
    status: 'idle',
    statusText: 'Disconnected',
    showOverlay: true,
    url: '',
    fps: null,
    navDisabled: true,
  }

  constructor() {
    this.connection.rebootstrap = () => this.bootstrapSession()
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
    this.screencast.attach(elements, (fps) => this.emit({ fps }))
    this.input.bind(elements)
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      if (w < 100 || h < 100) return
      if (w === this.sessionW && h === this.sessionH) return
      this.input.invalidateRect()
      if (this.resizeTimer) clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(async () => {
        this.syncCanvasSize(w, h)
        if (this.connection.hub) {
          try { await this.connection.hub.invoke('ResizeAsync', w, h) } catch { /* ignore */ }
        }
      }, 250)
    })
    this.resizeObserver.observe(elements.viewport)
    void this.connect()
  }

  unmount() {
    this.mounted = false
    this.input.unbind()
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    void this.stopSession()
    this.screencast.detach()
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
      this.clientConfig = await fetchClientConfig(API_URL, true)
    } catch {
      if (!this.isActive()) return
      this.emit({ status: 'error', statusText: 'Error: cannot reach server', showOverlay: true })
      this.connecting = false
      return
    }

    await this.stopSession()
    if (!this.isActive()) return

    try {
      await this.connection.start()
      if (!this.isActive()) {
        await this.stopSession()
        return
      }
      await this.bootstrapSession()
    } catch (err) {
      console.error('[connect]', err)
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ status: 'error', statusText: `Error: ${message}`, showOverlay: true })
      await this.stopSession()
    } finally {
      this.connecting = false
    }
  }

  private async bootstrapSession() {
    const elements = this.elements
    if (!this.isActive() || !this.connection.hub || !elements) return
    this.connection.teardownChannels()

    const initW = elements.viewport.clientWidth || 1280
    const initH = elements.viewport.clientHeight || 720
    this.syncCanvasSize(initW, initH)

    const clientToken = await this.connection.invokeStartSession(initW, initH)
    if (!clientToken) {
      await this.stopSession()
      return
    }
    if (this.clientConfig) saveClientToken(clientToken, this.clientConfig)

    this.connection.openChannels()
    this.input.setUserInputSubject(this.connection.getUserInputSubject())
    this.vcon.setConsoleInputSubject(this.connection.getConsoleInputSubject())

    this.emit({
      status: 'connected',
      statusText: 'Streaming',
      showOverlay: false,
      navDisabled: false,
      url: this.currentUrl,
    })
    elements.canvas.focus()
  }

  private onDisconnected() {
    this.emit({
      status: 'error',
      statusText: 'Disconnected — click to reconnect',
      showOverlay: true,
      navDisabled: true,
      url: '',
    })
    this.input.clearPointerState()
    this.screencast.teardown()
    this.vcon.reset()
    this.input.setUserInputSubject(null)
    this.connection.teardownChannels()
    this.connecting = false
  }

  private async stopSession() {
    this.screencast.teardown()
    this.vcon.reset()
    this.input.setUserInputSubject(null)
    await this.connection.stop()
  }

  private syncCanvasSize(w: number, h: number) {
    if (!this.elements) return
    this.sessionW = w
    this.sessionH = h
    this.elements.canvas.width = w
    this.elements.canvas.height = h
    this.input.invalidateRect()
  }

  private onConsoleOutput(output: ConsoleOutputPayload) {
    if (!this.elements) return
    this.vcon.handleConsoleOutput(output)
  }

  private applyMappedUrl(mapped: string) {
    if (!this.elements) return
    this.currentUrl = mapped
    if (document.activeElement !== this.elements.urlBar) {
      this.elements.urlBar.value = mapped
      this.emit({ url: mapped })
    }
    syncClientLocation(mapped, !!this.clientConfig?.mirroringEnabled)
  }

  private onSessionStatus(s: SessionStatusPayload) {
    this.vcon.setJsBridgeEnabled(!!s.jsBridgeEnabled)

    if (s.url && this.elements && document.activeElement !== this.elements.urlBar) {
      this.currentUrl = s.url
      this.elements.urlBar.value = s.url
      this.emit({ url: s.url })
      syncClientLocation(s.url, !!this.clientConfig?.mirroringEnabled)
    }
  }

  goBack() { this.input.goBack() }
  goForward() { this.input.goForward() }
}
