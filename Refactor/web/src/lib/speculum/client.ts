import { ControlPlane, type ControlPlaneOptions } from './control'
import { Emitter } from './emitter'
import { LiveSession } from './liveSession'
import type {
  EnsureProfileResult,
  JournalStreamObserver,
  JournalStreamSubscription,
  SessionEndedEvent,
  StartSessionRequest,
} from './types'

export interface SessionClientOptions extends ControlPlaneOptions {
  transportPath?: string
  /**
   * Origin for the WebTransport data plane when it differs from the hub origin.
   * WebTransport is HTTP/3-only, so dev proxies can forward `/vhub` but never
   * `/vtransport` — point this at the API's HTTPS origin in that case.
   */
  transportBaseUrl?: string
}

interface SessionClientEventMap {
  hubClose: unknown
  hubReconnecting: undefined
  hubReconnected: undefined
}

/**
 * Speculum browser client: control plane + live-session factory.
 *
 * @example
 * const client = createSessionClient()
 * await client.connect()
 * const { profileId } = await client.ensureProfile()
 * const session = await client.startSession({ profileId, path: '/' })
 * session.on('frame', (frame) => paint(frame.jpeg))
 * await session.stop()
 */
export class SessionClient extends Emitter<SessionClientEventMap> {
  private readonly options: SessionClientOptions
  private readonly control: ControlPlane
  private active: LiveSession | null = null

  constructor(options: SessionClientOptions = {}) {
    super()
    this.options = options
    this.control = new ControlPlane(options)
  }

  get connectionId(): string | null {
    return this.control.connectionId
  }

  get isConnected(): boolean {
    return this.control.isConnected
  }

  get activeSession(): LiveSession | null {
    return this.active
  }

  async connect(): Promise<void> {
    await this.control.connect({
      onclose: (error) => this.emit('hubClose', error),
      onreconnecting: () => this.emit('hubReconnecting'),
      onreconnected: () => this.emit('hubReconnected'),
    })
  }

  async disconnect(): Promise<void> {
    if (this.active) {
      await this.active.stop({ skipHub: true }).catch(() => {})
      this.active = null
    }
    await this.control.disconnect()
  }

  ensureProfile(profileId?: string | null): Promise<EnsureProfileResult> {
    return this.control.ensureProfile(profileId)
  }

  /** Observes Journal facts on the hub connection, independent of any session. */
  streamJournalFacts(observer: JournalStreamObserver): JournalStreamSubscription {
    return this.control.streamJournalFacts(observer)
  }

  /** Starts a session and opens the WebTransport data plane. */
  async startSession(request: StartSessionRequest): Promise<LiveSession> {
    if (this.active) {
      await this.active.stop().catch(() => {})
      this.active = null
    }

    // Register before StartSessionAsync — SyncUrl/Redirect/SessionEnded can fire during start.
    // Latest-wins: only the most recent URL matters once the session exists.
    let session: LiveSession | null = null
    let pendingSync: string | null = null
    let pendingRedirect: string | null = null
    let pendingEnded: SessionEndedEvent | null = null
    let commandsDisposed = false

    const offSync = this.control.onSyncUrl((url) => {
      if (session) {
        session.receiveSyncUrl(url)
      } else {
        pendingSync = url
      }
    })
    const offRedirect = this.control.onRedirect((url) => {
      if (session) {
        session.receiveRedirect(url)
      } else {
        pendingRedirect = url
      }
    })
    const offEnded = this.control.onSessionEnded((event) => {
      if (session) {
        session.receiveSessionEnded(event)
      } else {
        pendingEnded = event
      }
    })

    const disposeCommands = () => {
      if (commandsDisposed) {
        return
      }
      commandsDisposed = true
      offSync()
      offRedirect()
      offEnded()
    }

    try {
      const started = await this.control.startSession(request)
      session = new LiveSession({
        control: this.control,
        sessionId: started.sessionId,
        token: started.token,
        viewportMinWidth: started.viewportMinWidth,
        viewportMinHeight: started.viewportMinHeight,
        viewportMaxWidth: started.viewportMaxWidth,
        viewportMaxHeight: started.viewportMaxHeight,
        baseUrl: this.options.transportBaseUrl ?? this.options.baseUrl,
        certificateHashBaseUrl: this.options.baseUrl,
        transportPath: this.options.transportPath,
      })
      if (pendingSync) {
        session.receiveSyncUrl(pendingSync)
      }
      if (pendingRedirect) {
        session.receiveRedirect(pendingRedirect)
      }
      if (pendingEnded) {
        session.receiveSessionEnded(pendingEnded)
      }

      await session.open()

      this.active = session
      session.on('close', () => {
        disposeCommands()
        if (this.active === session) {
          this.active = null
        }
      })
      return session
    } catch (error) {
      disposeCommands()
      if (session) {
        // Hub already promoted Live — tear it down so a retry is not blocked by
        // an orphaned session/slot/binding. Bound the stop so a hung export cannot
        // freeze the lab UI forever.
        await withTimeout(session.stop().catch(() => {}), 5_000).catch(() => {})
      }
      throw error
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timed out')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function createSessionClient(options: SessionClientOptions = {}): SessionClient {
  return new SessionClient(options)
}
