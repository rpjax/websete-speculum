import type { ControlPlane } from './control'
import { Emitter } from './emitter'
import { DataPlane } from './transport'
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
  baseUrl?: string
  /** Hub origin for `/health/webtransport-cert` pin fetch. */
  certificateHashBaseUrl?: string
  transportPath?: string
}

/**
 * One live browsing session: hub lifecycle + WebTransport I/O.
 * Events: frame, console, notification, syncUrl, redirect, ended, error, close.
 */
export class LiveSession extends Emitter<SessionEventMap> {
  readonly sessionId: string
  readonly token: string
  private readonly control: ControlPlane
  private readonly data: DataPlane
  private disposers: Array<() => void> = []
  private stopped = false
  private _lastSyncedUrl: string | null = null
  private _lastRedirectUrl: string | null = null

  constructor(options: LiveSessionOptions) {
    super()
    this.sessionId = options.sessionId
    this.token = options.token
    this.control = options.control
    this.data = new DataPlane({
      baseUrl: options.baseUrl,
      certificateHashBaseUrl: options.certificateHashBaseUrl,
      transportPath: options.transportPath,
      sessionId: options.sessionId,
      token: options.token,
    })
  }

  get isOpen(): boolean {
    return !this.stopped && this.data.isOpen
  }

  /** Last SyncUrl seen (including events before listeners were bound). */
  get lastSyncedUrl(): string | null {
    return this._lastSyncedUrl
  }

  /** Last Redirect seen (including events before listeners were bound). */
  get lastRedirectUrl(): string | null {
    return this._lastRedirectUrl
  }

  /** Applies a hub SyncUrl (from SessionClient wiring). */
  receiveSyncUrl(url: string): void {
    const normalized = normalizeHttpUrl(url)
    if (!normalized) {
      return
    }
    this._lastSyncedUrl = normalized
    this.emit('syncUrl', normalized)
  }

  /** Applies a hub Redirect (from SessionClient wiring). */
  receiveRedirect(url: string): void {
    const normalized = normalizeHttpUrl(url)
    if (!normalized) {
      return
    }
    this._lastRedirectUrl = normalized
    this.emit('redirect', normalized)
  }

  /**
   * Applies hub SessionEnded: emit, then close the data plane without calling Stop
   * (the server already tore the session down or is doing so).
   */
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

  /** Runtime navigation via hub (path/query resolved server-side). */
  navigate(request: NavigateSessionRequest): Promise<void> {
    return this.control.navigateSession({
      sessionId: this.sessionId,
      token: this.token,
      path: request.path,
      query: request.query ?? '',
    })
  }

  /** Runtime canvas 1:1 resize via hub. */
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

  /** Stops the session via hub and closes the data plane. */
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

/** Accepts only absolute http(s) URLs for hub-driven navigation/sync. */
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
