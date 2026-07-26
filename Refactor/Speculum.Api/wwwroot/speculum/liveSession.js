import { Emitter } from './emitter.js'
import { DataPlane } from './transport.js'

/**
 * One live browsing session: hub lifecycle + WebTransport I/O.
 * Events: frame, console, notification, status, error, close
 */
export class LiveSession extends Emitter {
  /**
   * @param {{
   *   control: import('./control.js').ControlPlane,
   *   sessionId: string,
   *   token: string,
   *   baseUrl?: string,
   *   transportPath?: string,
   * }} options
   */
  constructor(options) {
    super()
    this.sessionId = options.sessionId
    this.token = options.token
    this._control = options.control
    this._data = new DataPlane({
      baseUrl: options.baseUrl,
      transportPath: options.transportPath,
      sessionId: options.sessionId,
      token: options.token,
    })
    this._disposers = []
    this._stopped = false
  }

  get isOpen() {
    return !this._stopped && this._data.isOpen
  }

  async open() {
    this.#forward('frame')
    this.#forward('console')
    this.#forward('notification')
    this.#forward('error')
    this._disposers.push(
      this._data.on('close', () => this.emit('close')),
    )
    await this._data.open()
  }

  /**
   * @param {{ type: string } & Record<string, unknown>} event
   */
  sendInput(event) {
    return this._data.sendInput(event)
  }

  /** @param {string} code */
  evaluate(code) {
    return this._data.evaluate(code)
  }

  getStatus() {
    return this._data.getStatus()
  }

  /**
   * Stops the session via hub and closes the data plane.
   * @param {{ skipHub?: boolean }} [options]
   */
  async stop(options = {}) {
    if (this._stopped) {
      return
    }
    this._stopped = true
    try {
      if (!options.skipHub) {
        await this._control.stopSession({
          sessionId: this.sessionId,
          token: this.token,
        })
      }
    } finally {
      await this._data.close()
      for (const dispose of this._disposers) {
        dispose()
      }
      this._disposers = []
    }
  }

  /** @param {string} type */
  #forward(type) {
    this._disposers.push(
      this._data.on(type, (event) => this.emit(type, event.detail)),
    )
  }
}
