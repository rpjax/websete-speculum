import {
  ConsoleOutputKind,
  DefaultTransportPath,
  PipeKind,
} from './constants.js'
import { Emitter } from './emitter.js'
import {
  readMessages,
  readPipeKind,
  writeMessage,
  writePipeHeader,
} from './framing.js'

/**
 * WebTransport data plane for /vtransport.
 * Emits: frame, console, notification, status, error, close
 */
export class DataPlane extends Emitter {
  /**
   * @param {{
   *   baseUrl?: string,
   *   transportPath?: string,
   *   sessionId: string,
   *   token: string,
   * }} options
   */
  constructor(options) {
    super()
    this.baseUrl = options.baseUrl ?? ''
    this.transportPath = options.transportPath ?? DefaultTransportPath
    this.sessionId = options.sessionId
    this.token = options.token
    /** @type {WebTransport|null} */
    this._transport = null
    /** @type {WritableStreamDefaultWriter<Uint8Array>|null} */
    this._userInput = null
    /** @type {WritableStreamDefaultWriter<Uint8Array>|null} */
    this._consoleInput = null
    /** @type {AbortController|null} */
    this._lifetime = null
    /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }>} */
    this._pendingEval = new Map()
    this._nextEvalId = 1
    this._closed = false
  }

  get isOpen() {
    return !this._closed && this._transport != null
  }

  async open() {
    if (typeof WebTransport !== 'function') {
      throw new Error('WebTransport is not available in this browser')
    }

    await this.close()
    this._closed = false
    this._lifetime = new AbortController()

    const url = buildTransportUrl(
      this.baseUrl,
      this.transportPath,
      this.sessionId,
      this.token,
    )
    this._transport = new WebTransport(url)
    await this._transport.ready

    this._userInput = await this.#openUnidirectional(PipeKind.UserInput)
    this._consoleInput = await this.#openBidirectionalWriter(PipeKind.ConsoleInput)

    this.#pumpIncoming()
    this.#watchClosed()
  }

  /**
   * @param {{ type: string } & Record<string, unknown>} event
   */
  async sendInput(event) {
    if (!this._userInput) {
      throw new Error('Data plane is not open')
    }
    const type = String(event.type ?? '')
    const payload = JSON.stringify(event)
    await writeMessage(this._userInput, { type, payload })
  }

  /**
   * @param {string} code
   * @returns {Promise<{ ok: boolean, value?: string, error?: string, requestId: number }>}
   */
  async evaluate(code) {
    if (!this._consoleInput) {
      throw new Error('Data plane is not open')
    }
    const id = this._nextEvalId++
    const result = new Promise((resolve, reject) => {
      this._pendingEval.set(id, { resolve, reject })
    })
    await writeMessage(this._consoleInput, { id, code })
    return result
  }

  /** @returns {Promise<object>} */
  async getStatus() {
    if (!this._transport) {
      throw new Error('Data plane is not open')
    }
    const stream = await this._transport.createBidirectionalStream()
    const writer = stream.writable.getWriter()
    const reader = stream.readable.getReader()
    try {
      await writePipeHeader(writer, PipeKind.Status)
      for await (const message of readMessages(reader)) {
        return /** @type {object} */ (message)
      }
      throw new Error('Status response was empty')
    } finally {
      try {
        await writer.close()
      } catch {
        // ignore
      }
      reader.releaseLock()
    }
  }

  async close() {
    if (this._closed && !this._transport) {
      return
    }
    this._closed = true
    this._lifetime?.abort()
    this._lifetime = null

    for (const [, pending] of this._pendingEval) {
      pending.reject(new Error('Data plane closed'))
    }
    this._pendingEval.clear()

    await closeWriter(this._userInput)
    await closeWriter(this._consoleInput)
    this._userInput = null
    this._consoleInput = null

    const transport = this._transport
    this._transport = null
    if (transport) {
      try {
        transport.close()
      } catch {
        // ignore
      }
      try {
        await transport.closed
      } catch {
        // ignore
      }
    }
    this.emit('close')
  }

  async #openUnidirectional(kind) {
    const stream = await this._transport.createUnidirectionalStream()
    const writer = stream.getWriter()
    await writePipeHeader(writer, kind)
    return writer
  }

  async #openBidirectionalWriter(kind) {
    const stream = await this._transport.createBidirectionalStream()
    const writer = stream.writable.getWriter()
    await writePipeHeader(writer, kind)
    // JsBridge-disabled rejections are written back on this duplex;
    // live eval results also arrive on the console output pipe.
    void this.#pumpDuplexResponses(stream.readable.getReader())
    return writer
  }

  async #pumpDuplexResponses(reader) {
    try {
      for await (const message of readMessages(reader)) {
        this.#onConsole(message)
      }
    } catch {
      // stream ended
    }
  }

  #pumpIncoming() {
    const transport = this._transport
    const signal = this._lifetime?.signal
    if (!transport || !signal) {
      return
    }

    ;(async () => {
      const reader = transport.incomingUnidirectionalStreams.getReader()
      try {
        while (!signal.aborted) {
          const { value: stream, done } = await reader.read()
          if (done || !stream) {
            break
          }
          void this.#handleIncoming(stream)
        }
      } catch (error) {
        if (!signal.aborted) {
          this.emit('error', error)
        }
      } finally {
        reader.releaseLock()
      }
    })()
  }

  /**
   * @param {ReadableStream<Uint8Array>} stream
   */
  async #handleIncoming(stream) {
    const reader = stream.getReader()
    try {
      const kind = await readPipeKind(reader)
      if (kind == null) {
        return
      }

      for await (const message of readMessages(reader)) {
        switch (kind) {
          case PipeKind.Frame:
            this.emit('frame', message)
            break
          case PipeKind.ConsoleOutput:
            this.#onConsole(message)
            break
          case PipeKind.Notification:
            this.emit('notification', message)
            break
          default:
            break
        }
      }
    } catch (error) {
      if (!this._closed) {
        this.emit('error', error)
      }
    } finally {
      reader.releaseLock()
    }
  }

  /** @param {any} message */
  #onConsole(message) {
    this.emit('console', message)
    if (message?.kind === ConsoleOutputKind.EvalResult && message.requestId != null) {
      const pending = this._pendingEval.get(Number(message.requestId))
      if (pending) {
        this._pendingEval.delete(Number(message.requestId))
        pending.resolve({
          requestId: Number(message.requestId),
          ok: Boolean(message.ok),
          value: message.value,
          error: message.error,
        })
      }
    }
  }

  #watchClosed() {
    const transport = this._transport
    if (!transport) {
      return
    }
    transport.closed
      .then(() => this.close())
      .catch(() => this.close())
  }
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {string} sessionId
 * @param {string} token
 */
function buildTransportUrl(baseUrl, path, sessionId, token) {
  const origin = resolveOrigin(baseUrl)
  const url = new URL(path, origin)
  // Chromium allows http://localhost; everything else needs https + HTTP/3.
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  if (url.protocol === 'http:' && !local) {
    url.protocol = 'https:'
  }
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('token', token)
  return url.toString()
}

/** @param {string} baseUrl */
function resolveOrigin(baseUrl) {
  if (!baseUrl) {
    return location.origin
  }
  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  }
  return new URL(baseUrl, location.origin).origin + '/'
}

/** @param {WritableStreamDefaultWriter<Uint8Array>|null} writer */
async function closeWriter(writer) {
  if (!writer) {
    return
  }
  try {
    await writer.close()
  } catch {
    try {
      writer.releaseLock()
    } catch {
      // ignore
    }
  }
}
