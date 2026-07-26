import { ControlPlane } from './control.js'
import { Emitter } from './emitter.js'
import { LiveSession } from './liveSession.js'

/**
 * Speculum browser client: control plane + live-session factory.
 *
 * @example
 * const client = createSessionClient()
 * await client.connect()
 * const session = await client.startSession({ profileId, path: '/' })
 * session.on('frame', ({ detail }) => paint(detail.jpeg))
 * await session.stop()
 * await client.disconnect()
 */
export class SessionClient extends Emitter {
  /**
   * @param {{
   *   baseUrl?: string,
   *   hubPath?: string,
   *   transportPath?: string,
   *   withCredentials?: boolean,
   * }} [options]
   */
  constructor(options = {}) {
    super()
    this.options = options
    this._control = new ControlPlane(options)
    /** @type {LiveSession|null} */
    this._active = null
  }

  get connectionId() {
    return this._control.connectionId
  }

  get isConnected() {
    return this._control.isConnected
  }

  get activeSession() {
    return this._active
  }

  async connect() {
    await this._control.connect({
      onclose: (error) => this.emit('hubClose', error),
      onreconnecting: () => this.emit('hubReconnecting'),
      onreconnected: () => this.emit('hubReconnected'),
    })
  }

  async disconnect() {
    if (this._active) {
      await this._active.stop({ skipHub: true }).catch(() => {})
      this._active = null
    }
    await this._control.disconnect()
  }

  /**
   * Starts a session and opens the WebTransport data plane.
   * @param {import('./control.js').StartSessionRequest} request
   * @returns {Promise<LiveSession>}
   */
  async startSession(request) {
    if (this._active) {
      await this._active.stop().catch(() => {})
      this._active = null
    }

    const started = await this._control.startSession(request)
    const session = new LiveSession({
      control: this._control,
      sessionId: started.sessionId,
      token: started.token,
      baseUrl: this.options.baseUrl,
      transportPath: this.options.transportPath,
    })

    try {
      await session.open()
    } catch (error) {
      await this._control
        .stopSession({
          sessionId: started.sessionId,
          token: started.token,
        })
        .catch(() => {})
      throw error
    }

    session.on('close', () => {
      if (this._active === session) {
        this._active = null
      }
    })

    this._active = session
    this.emit('sessionStarted', session)
    return session
  }
}

/**
 * @param {ConstructorParameters<typeof SessionClient>[0]} [options]
 */
export function createSessionClient(options) {
  return new SessionClient(options)
}
