import * as signalR from '@microsoft/signalr'
import * as msgpack from '@microsoft/signalr-protocol-msgpack'
import { API_URL } from '@/lib/env'
import { loadClientToken } from '@/lib/clientConfig'
import type {
  ConsoleOutputPayload,
  FramePayload,
  SessionStatusPayload,
} from './types'

function isSetupRequiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /não configurado|not configured|Motor não configurado/i.test(msg)
}

export interface MotorConnectionHandlers {
  onFrame: (frame: FramePayload) => void
  onConsoleOutput: (output: ConsoleOutputPayload) => void
  onSessionStatus: (status: SessionStatusPayload) => void
  onDisconnected: () => void
  onReconnecting: () => void
  emitError: (message: string) => void
}

export class MotorConnection {
  private connection: signalR.HubConnection | null = null
  private streamDisposers: Array<() => void> = []
  private userInputSubject: signalR.Subject<string> | null = null
  private consoleInputSubject: signalR.Subject<{ id: number; code: string }> | null = null
  private handlers: MotorConnectionHandlers

  constructor(handlers: MotorConnectionHandlers) {
    this.handlers = handlers
  }

  get hub() {
    return this.connection
  }

  getUserInputSubject() {
    return this.userInputSubject
  }

  getConsoleInputSubject() {
    return this.consoleInputSubject
  }

  async start(): Promise<void> {
    await this.stop()
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${API_URL}/vhub`, {
        withCredentials: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withHubProtocol(new msgpack.MessagePackHubProtocol())
      .withAutomaticReconnect()
      .build()

    this.connection.onclose(() => {
      this.connection = null
      this.teardownChannels()
      this.handlers.onDisconnected()
    })
    this.connection.onreconnecting(() => this.handlers.onReconnecting())
    this.connection.onreconnected(async () => {
      try {
        await this.rebootstrap?.()
      } catch (err) {
        console.error('[reconnect]', err)
        await this.stop()
        this.handlers.emitError('Reconnect failed — click to retry')
      }
    })

    await this.connection.start()
  }

  /** Set by MotorEngine after construction — used for reconnect bootstrap. */
  rebootstrap: (() => Promise<void>) | null = null

  async invokeStartSession(initW: number, initH: number): Promise<string | null> {
    if (!this.connection) return null
    try {
      return await this.connection.invoke<string>(
        'StartSessionAsync',
        window.location.href,
        initW,
        initH,
        { clientToken: loadClientToken() },
      )
    } catch (err) {
      if (isSetupRequiredError(err)) {
        window.location.replace('/setup')
        return null
      }
      throw err
    }
  }

  openChannels() {
    if (!this.connection) return

    this.subscribeStream<FramePayload>('OpenFrameChannel', {
      next: (frame) => this.handlers.onFrame(frame),
      error: (err) => console.error('[frame stream]', err),
      complete: () => {},
    })

    this.subscribeStream<ConsoleOutputPayload>('OpenConsoleOutputChannel', {
      next: (output) => this.handlers.onConsoleOutput(output),
      error: (err) => console.error('[console stream]', err),
      complete: () => {},
    })

    this.subscribeStream<SessionStatusPayload>('OpenStatusChannel', {
      next: (status) => this.handlers.onSessionStatus(status),
      error: (err) => console.warn('[status stream]', err),
      complete: () => {},
    })

    this.userInputSubject = new signalR.Subject()
    this.consoleInputSubject = new signalR.Subject()
    this.connection.send('OpenUserInputChannel', this.userInputSubject)
    this.connection.send('OpenConsoleInputChannel', this.consoleInputSubject)
  }

  teardownChannels() {
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

  async stop() {
    this.teardownChannels()
    if (this.connection) {
      try { await this.connection.stop() } catch { /* ignore */ }
      this.connection = null
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
}
