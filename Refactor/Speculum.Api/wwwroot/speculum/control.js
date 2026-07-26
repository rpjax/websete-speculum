import {
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
} from '@microsoft/signalr'
import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'
import { DefaultHubPath } from './constants.js'

/**
 * @typedef {object} StartSessionRequest
 * @property {string} profileId
 * @property {string} [path]
 * @property {string} [query]
 * @property {number} [viewportWidth]
 * @property {number} [viewportHeight]
 * @property {object} [device]
 * @property {object} [clientEnvironment]
 */

/**
 * @typedef {object} StartSessionResult
 * @property {string} sessionId
 * @property {string} token
 */

/**
 * SignalR control plane for /vhub (Start/Stop only).
 */
export class ControlPlane {
  /**
   * @param {{ baseUrl?: string, hubPath?: string, withCredentials?: boolean }} [options]
   */
  constructor(options = {}) {
    this.baseUrl = trimSlash(options.baseUrl ?? '')
    this.hubPath = options.hubPath ?? DefaultHubPath
    this.withCredentials = options.withCredentials !== false
    /** @type {import('@microsoft/signalr').HubConnection|null} */
    this._connection = null
  }

  get connectionId() {
    return this._connection?.connectionId ?? null
  }

  get isConnected() {
    return this._connection?.state === 'Connected'
  }

  /**
   * @param {{ onclose?: (error?: Error) => void, onreconnecting?: () => void, onreconnected?: () => void }} [handlers]
   */
  async connect(handlers = {}) {
    await this.disconnect()
    const url = `${this.baseUrl}${this.hubPath}`
    this._connection = new HubConnectionBuilder()
      .withUrl(url, {
        withCredentials: this.withCredentials,
        transport: HttpTransportType.WebSockets,
      })
      .withHubProtocol(new MessagePackHubProtocol())
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()

    this._connection.onclose((error) => handlers.onclose?.(error))
    this._connection.onreconnecting(() => handlers.onreconnecting?.())
    this._connection.onreconnected(() => handlers.onreconnected?.())

    await this._connection.start()
  }

  async disconnect() {
    if (!this._connection) {
      return
    }
    const connection = this._connection
    this._connection = null
    try {
      await connection.stop()
    } catch {
      // best-effort
    }
  }

  /**
   * @param {StartSessionRequest} request
   * @returns {Promise<StartSessionResult>}
   */
  async startSession(request) {
    const connection = this.#requireConnection()
    const response = await connection.invoke('StartSessionAsync', {
      profileId: request.profileId,
      path: request.path ?? '/',
      query: request.query ?? '',
      viewportWidth: request.viewportWidth ?? 0,
      viewportHeight: request.viewportHeight ?? 0,
      device: request.device ?? null,
      clientEnvironment: request.clientEnvironment ?? null,
    })
    return {
      sessionId: String(response.sessionId),
      token: String(response.token),
    }
  }

  /**
   * @param {{ sessionId: string, token: string }} request
   */
  async stopSession(request) {
    const connection = this.#requireConnection()
    await connection.invoke('StopSessionAsync', {
      sessionId: request.sessionId,
      token: request.token,
    })
  }

  #requireConnection() {
    if (!this._connection) {
      throw new Error('Control plane is not connected')
    }
    return this._connection
  }
}

/** @param {string} value */
function trimSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}
