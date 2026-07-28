import {
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
  type HubConnection,
} from '@microsoft/signalr'
import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'
import { DefaultHubPath } from './constants'
import type {
  EnsureProfileResult,
  JournalFact,
  JournalStreamObserver,
  JournalStreamSubscription,
  SessionEndedEvent,
  StartSessionRequest,
  StartSessionResult,
  ResizeSessionRequest,
  ResizeSessionResult,
} from './types'

export interface ControlPlaneOptions {
  baseUrl?: string
  hubPath?: string
  withCredentials?: boolean
}

export interface ControlPlaneHandlers {
  onclose?: (error?: Error) => void
  onreconnecting?: () => void
  onreconnected?: () => void
}

/** SignalR control plane for /vhub (EnsureProfile / Start / Stop). */
export class ControlPlane {
  private readonly baseUrl: string
  private readonly hubPath: string
  private readonly withCredentials: boolean
  private connection: HubConnection | null = null

  constructor(options: ControlPlaneOptions = {}) {
    this.baseUrl = trimSlash(options.baseUrl ?? '')
    this.hubPath = options.hubPath ?? DefaultHubPath
    this.withCredentials = options.withCredentials !== false
  }

  get connectionId(): string | null {
    return this.connection?.connectionId ?? null
  }

  get isConnected(): boolean {
    return this.connection?.state === 'Connected'
  }

  async connect(handlers: ControlPlaneHandlers = {}): Promise<void> {
    await this.disconnect()
    const connection = new HubConnectionBuilder()
      .withUrl(`${this.baseUrl}${this.hubPath}`, {
        withCredentials: this.withCredentials,
        transport: HttpTransportType.WebSockets,
      })
      .withHubProtocol(new MessagePackHubProtocol())
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()

    connection.onclose((error) => handlers.onclose?.(error))
    connection.onreconnecting(() => handlers.onreconnecting?.())
    connection.onreconnected(() => handlers.onreconnected?.())

    this.connection = connection
    await connection.start()
  }

  async disconnect(): Promise<void> {
    const connection = this.connection
    if (!connection) {
      return
    }
    this.connection = null
    try {
      await connection.stop()
    } catch {
      // best-effort
    }
  }

  /** Resolves an existing profile or creates one; required before StartSession. */
  async ensureProfile(profileId?: string | null): Promise<EnsureProfileResult> {
    const connection = this.requireConnection()
    const response = await connection.invoke<{ profileId: string; created: boolean }>(
      'EnsureProfileAsync',
      { profileId: profileId ?? null },
    )
    return {
      profileId: String(response.profileId),
      created: Boolean(response.created),
    }
  }

  async startSession(request: StartSessionRequest): Promise<StartSessionResult> {
    const connection = this.requireConnection()
    const response = await connection.invoke<Record<string, unknown>>(
      'StartSessionAsync',
      {
        profileId: request.profileId,
        path: request.path ?? '/',
        query: request.query ?? '',
        viewportWidth: request.viewportWidth ?? 0,
        viewportHeight: request.viewportHeight ?? 0,
        device: request.device ?? null,
        clientEnvironment: request.clientEnvironment ?? null,
      },
    )
    return {
      sessionId: String(response.sessionId),
      token: String(response.token),
      viewportMinWidth: Number(response.viewportMinWidth),
      viewportMinHeight: Number(response.viewportMinHeight),
      viewportMaxWidth: Number(response.viewportMaxWidth),
      viewportMaxHeight: Number(response.viewportMaxHeight),
    }
  }

  /**
   * Observes Journal facts as the API admits them. Live only: facts stored before
   * the subscription are not replayed. Dispose to stop the server-side stream.
   */
  streamJournalFacts(observer: JournalStreamObserver): JournalStreamSubscription {
    const connection = this.requireConnection()
    return connection.stream<Record<string, unknown>>('StreamJournalAsync').subscribe({
      next: (fact) => observer.next(toJournalFact(fact)),
      error: (error) => observer.error?.(error),
      complete: () => observer.complete?.(),
    })
  }

  /** Registers a SyncUrl handler; returns disposer. */
  onSyncUrl(handler: (url: string) => void): () => void {
    return this.onHubEvent('SyncUrl', handler)
  }

  /** Registers a Redirect handler; returns disposer. */
  onRedirect(handler: (url: string) => void): () => void {
    return this.onHubEvent('Redirect', handler)
  }

  /** Registers a SessionEnded handler; returns disposer. */
  onSessionEnded(handler: (event: SessionEndedEvent) => void): () => void {
    const connection = this.requireConnection()
    const listener = (payload: unknown) => {
      const event = readSessionEnded(payload)
      if (event) {
        handler(event)
      }
    }
    const aliases = ['SessionEnded', 'sessionEnded', 'sessionended']
    for (const name of aliases) {
      connection.on(name, listener)
    }
    return () => {
      for (const name of aliases) {
        connection.off(name, listener)
      }
    }
  }

  async stopSession(request: { sessionId: string; token: string }): Promise<void> {
    const connection = this.requireConnection()
    await connection.invoke('StopSessionAsync', {
      sessionId: request.sessionId,
      token: request.token,
    })
  }

  async navigateSession(request: {
    sessionId: string
    token: string
    path: string
    query?: string
  }): Promise<void> {
    const connection = this.requireConnection()
    await connection.invoke('NavigateAsync', {
      sessionId: request.sessionId,
      token: request.token,
      path: request.path,
      query: request.query ?? '',
    })
  }

  async resizeSession(request: {
    sessionId: string
    token: string
  } & ResizeSessionRequest): Promise<ResizeSessionResult> {
    const connection = this.requireConnection()
    const response = await connection.invoke<Record<string, unknown>>('ResizeAsync', {
      sessionId: request.sessionId,
      token: request.token,
      width: request.width,
      height: request.height,
      requestId: request.requestId ?? null,
      device: request.device ?? null,
    })
    return {
      applied: Boolean(response.applied),
      width: Number(response.width ?? 0),
      height: Number(response.height ?? 0),
      chromeWidth: optionalNumber(response.chromeWidth),
      chromeHeight: optionalNumber(response.chromeHeight),
      displayWidth: optionalNumber(response.displayWidth),
      displayHeight: optionalNumber(response.displayHeight),
      resizeId: optionalString(response.resizeId),
      errorCode: optionalString(response.errorCode),
      phase: optionalString(response.phase),
      message: optionalString(response.message),
    }
  }

  /**
   * Admits one user-input event on the hub (product path). Uses send() so the caller
   * only waits for the socket write — not server processing.
   */
  async sendInput(request: {
    sessionId: string
    token: string
    type: string
    payload: string
  }): Promise<void> {
    const connection = this.requireConnection()
    await connection.send('SendInputAsync', {
      sessionId: request.sessionId,
      token: request.token,
      type: request.type,
      payload: request.payload,
    })
  }

  private onHubEvent(method: string, handler: (url: string) => void): () => void {
    const connection = this.requireConnection()
    const listener = (payload: unknown) => {
      const url = readHubUrl(payload)
      if (url) {
        handler(url)
      }
    }
    // SignalR + MessagePack may deliver PascalCase, camelCase, or all-lowercase.
    const aliases = method === 'SyncUrl'
      ? ['SyncUrl', 'syncUrl', 'syncurl']
      : method === 'Redirect'
        ? ['Redirect', 'redirect']
        : [method]
    for (const name of aliases) {
      connection.on(name, listener)
    }
    return () => {
      for (const name of aliases) {
        connection.off(name, listener)
      }
    }
  }

  private requireConnection(): HubConnection {
    if (!this.connection) {
      throw new Error('Control plane is not connected')
    }
    return this.connection
  }
}

function readHubUrl(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload
  }
  if (payload instanceof Map) {
    return String(payload.get('url') ?? '')
  }
  if (payload && typeof payload === 'object' && 'url' in payload) {
    return String((payload as { url?: unknown }).url ?? '')
  }
  return ''
}

function readSessionEnded(payload: unknown): SessionEndedEvent | null {
  const record = readHubRecord(payload)
  if (!record) {
    return null
  }
  const sessionId = String(record.sessionId ?? record.SessionId ?? '').trim()
  const reason = String(record.reason ?? record.Reason ?? '').trim()
  if (!sessionId || !reason) {
    return null
  }
  const errorCode = record.errorCode ?? record.ErrorCode
  const message = record.message ?? record.Message
  return {
    sessionId,
    reason,
    errorCode: errorCode == null || errorCode === '' ? undefined : String(errorCode),
    message: message == null || message === '' ? undefined : String(message),
  }
}

function readHubRecord(payload: unknown): Record<string, unknown> | null {
  if (payload instanceof Map) {
    const record: Record<string, unknown> = {}
    for (const [key, value] of payload) {
      record[String(key)] = value
    }
    return record
  }
  if (payload && typeof payload === 'object') {
    return payload as Record<string, unknown>
  }
  return null
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value == null) {
    return value as null | undefined
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function optionalString(value: unknown): string | null | undefined {
  if (value == null) {
    return value as null | undefined
  }
  const s = String(value)
  return s === '' ? undefined : s
}

function toJournalFact(raw: Record<string, unknown>): JournalFact {
  const indexKeys: Record<string, string> = {}
  const rawKeys = raw.indexKeys
  if (rawKeys instanceof Map) {
    for (const [key, value] of rawKeys) {
      indexKeys[String(key)] = String(value)
    }
  } else if (rawKeys && typeof rawKeys === 'object') {
    for (const [key, value] of Object.entries(rawKeys)) {
      indexKeys[key] = String(value)
    }
  }

  return {
    id: String(raw.id ?? ''),
    publishedAt: String(raw.publishedAt ?? ''),
    type: String(raw.type ?? ''),
    schemaVersion: Number(raw.schemaVersion ?? 0),
    publishPolicy: String(raw.publishPolicy ?? ''),
    indexKeys,
    payload: typeof raw.payload === 'string' ? raw.payload : undefined,
  }
}
