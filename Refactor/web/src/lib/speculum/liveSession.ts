import type { ControlPlane } from './control'
import { DataStreams } from './dataStreams'
import type { DataStreamTransport } from './dataStreamTransport'
import { Emitter } from './emitter'
import type {
  NavigateSessionRequest,
  ResizeSessionRequest,
  ResizeSessionResult,
  SessionEndedEvent,
  SessionEventMap,
  SessionInput,
} from './types'

export interface LiveSessionOptions {
  control: ControlPlane
  sessionId: string
  token: string
  /** Sessions.ViewportPolicy bounds from StartSession (sole client resize limits). */
  viewportMinWidth: number
  viewportMinHeight: number
  viewportMaxWidth: number
  viewportMaxHeight: number
  baseUrl?: string
  /** Hub origin for `/w7s/health/webtransport-cert` pin fetch. */
  certificateHashBaseUrl?: string
  transportPath?: string
  /** Defaults to WebTransport. */
  transport?: DataStreamTransport
}

/**
 * One live browsing session: hub lifecycle + data streams I/O.
 * Events: frame, console, notification, syncUrl, redirect, ended, error, close.
 */
export class LiveSession extends Emitter<SessionEventMap> {
  readonly sessionId: string
  readonly token: string
  readonly viewportMinWidth: number
  readonly viewportMinHeight: number
  readonly viewportMaxWidth: number
  readonly viewportMaxHeight: number
  private readonly control: ControlPlane
  private readonly data: DataStreams
  private disposers: Array<() => void> = []
  private stopped = false
  private _lastSyncedUrl: string | null = null
  private _lastRedirectUrl: string | null = null

  constructor(options: LiveSessionOptions) {
    super()
    this.sessionId = options.sessionId
    this.token = options.token
    this.viewportMinWidth = options.viewportMinWidth
    this.viewportMinHeight = options.viewportMinHeight
    this.viewportMaxWidth = options.viewportMaxWidth
    this.viewportMaxHeight = options.viewportMaxHeight
    this.control = options.control
    this.data = new DataStreams({
      baseUrl: options.baseUrl,
      certificateHashBaseUrl: options.certificateHashBaseUrl,
      transportPath: options.transportPath,
      sessionId: options.sessionId,
      token: options.token,
      transport: options.transport,
    })
  }

  get isOpen(): boolean {
    return !this.stopped && this.data.isOpen
  }

  get lastSyncedUrl(): string | null {
    return this._lastSyncedUrl
  }

  get lastRedirectUrl(): string | null {
    return this._lastRedirectUrl
  }

  receiveSyncUrl(url: string): void {
    const normalized = normalizeHttpUrl(url)
    if (!normalized) {
      return
    }
    this._lastSyncedUrl = normalized
    this.emit('syncUrl', normalized)
  }

  receiveRedirect(url: string): void {
    const normalized = normalizeHttpUrl(url)
    if (!normalized) {
      return
    }
    this._lastRedirectUrl = normalized
    this.emit('redirect', normalized)
  }

  receiveSessionEnded(event: SessionEndedEvent): void {
    if (event.sessionId && event.sessionId !== this.sessionId) {
      return
    }
    this.emit('ended', event)
    void this.stop({ skipHub: true })
  }

  async open(): Promise<void> {
    this.forward('frame')
    this.forward('console')
    this.forward('notification')
    this.forward('error')
    this.disposers.push(this.data.on('close', () => this.emit('close')))
    await this.data.open()
  }

  sendInput(input: SessionInput): Promise<void> {
    return this.data.sendInput(input)
  }

  evaluate(code: string) {
    return this.data.evaluate(code)
  }

  getStatus() {
    return this.data.getStatus()
  }

  navigate(request: NavigateSessionRequest): Promise<void> {
    return this.control.navigateSession({
      sessionId: this.sessionId,
      token: this.token,
      path: request.path,
      query: request.query ?? '',
    })
  }

  resize(request: ResizeSessionRequest): Promise<ResizeSessionResult> {
    return this.control.resizeSession({
      sessionId: this.sessionId,
      token: this.token,
      width: request.width,
      height: request.height,
      requestId: request.requestId,
      device: request.device,
    })
  }

  async stop(options: { skipHub?: boolean } = {}): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    try {
      if (!options.skipHub) {
        await this.control.stopSession({
          sessionId: this.sessionId,
          token: this.token,
        })
      }
    } finally {
      await this.data.close()
      for (const dispose of this.disposers) {
        dispose()
      }
      this.disposers = []
    }
  }

  private forward<K extends keyof SessionEventMap & string>(type: K): void {
    this.disposers.push(
      this.data.on(type, (detail) => this.emit(type, detail)),
    )
  }
}

function normalizeHttpUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return trimmed
  } catch {
    return null
  }
}
