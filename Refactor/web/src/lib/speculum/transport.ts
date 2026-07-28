import { ConsoleOutputKind, DefaultTransportPath, PipeKind } from './constants'
import { Emitter } from './emitter'
import { FramedReader, writeMessage, writePipeHeader } from './framing'
import type {
  EvalResult,
  SessionConsoleOutput,
  SessionEventMap,
  SessionInput,
  SessionStatus,
} from './types'

export interface DataPlaneOptions {
  baseUrl?: string
  /** Origin used to fetch `/health/webtransport-cert` for hash pinning (usually the hub). */
  certificateHashBaseUrl?: string
  transportPath?: string
  sessionId: string
  token: string
}

/**
 * WebTransport data plane for /vtransport (frames, console, notifications, eval, status).
 * User input is admitted on the SignalR control plane — see {@link ControlPlane.sendInput}.
 */
export class DataPlane extends Emitter<SessionEventMap> {
  private readonly baseUrl: string
  private readonly certificateHashBaseUrl: string
  private readonly transportPath: string
  private readonly sessionId: string
  private readonly token: string
  private transport: WebTransport | null = null
  private consoleInput: WritableStreamDefaultWriter<Uint8Array> | null = null
  /** Serialize concurrent writes on this pipe's writer (WritableStream single-writer). */
  private consoleInputWriteChain: Promise<void> = Promise.resolve()
  private lifetime: AbortController | null = null
  private readonly pendingEval = new Map<
    number,
    { resolve: (value: EvalResult) => void; reject: (error: Error) => void }
  >()
  private nextEvalId = 1
  private closed = false

  constructor(options: DataPlaneOptions) {
    super()
    this.baseUrl = options.baseUrl ?? ''
    this.certificateHashBaseUrl = options.certificateHashBaseUrl ?? options.baseUrl ?? ''
    this.transportPath = options.transportPath ?? DefaultTransportPath
    this.sessionId = options.sessionId
    this.token = options.token
  }

  get isOpen(): boolean {
    return !this.closed && this.transport != null
  }

  async open(): Promise<void> {
    if (typeof WebTransport !== 'function') {
      throw new Error('WebTransport is not available in this browser')
    }

    await this.close()
    this.closed = false
    this.lifetime = new AbortController()

    const url = buildTransportUrl(
      this.baseUrl,
      this.transportPath,
      this.sessionId,
      this.token,
    )
    if (url.startsWith('http:')) {
      throw new Error(
        "WebTransport requires https (HTTP/3). Set Transport origin in Wire — for dockup lab use https://localhost:8443.",
      )
    }

    const serverCertificateHashes = await fetchServerCertificateHashes(
      this.certificateHashBaseUrl,
    )

    const transport = serverCertificateHashes
      ? new WebTransport(url, { serverCertificateHashes })
      : new WebTransport(url)
    this.transport = transport

    try {
      await withTimeout(transport.ready, 15_000, 'WebTransport ready timed out')
    } catch (error) {
      this.transport = null
      try {
        transport.close()
      } catch {
        // ignore
      }
      throw error
    }

    // User input uses SignalR AdmitUserInput (Kestrel has no WT datagrams; client-initiated
    // UserInput streams are unreliable on some Docker Desktop lab paths).
    this.consoleInput = await this.openBidirectionalWriter(PipeKind.ConsoleInput)
    this.pumpIncoming()
    this.watchClosed()
  }

  async sendInput(_input: SessionInput): Promise<void> {
    throw new Error(
      'DataPlane.sendInput is disabled — use ControlPlane.sendInput (SignalR AdmitUserInput)',
    )
  }

  async evaluate(code: string): Promise<EvalResult> {
    if (!this.consoleInput) {
      throw new Error('Data plane is not open')
    }
    const id = this.nextEvalId++
    const result = new Promise<EvalResult>((resolve, reject) => {
      this.pendingEval.set(id, { resolve, reject })
    })
    const writer = this.consoleInput
    const write = this.consoleInputWriteChain.then(() =>
      writeMessage(writer, { id, code }),
    )
    this.consoleInputWriteChain = write.then(
      () => undefined,
      () => undefined,
    )
    await write
    return result
  }

  async getStatus(): Promise<SessionStatus> {
    const transport = this.transport
    if (!transport) {
      throw new Error('Data plane is not open')
    }
    const stream = await transport.createBidirectionalStream()
    const writer = stream.writable.getWriter()
    const reader = stream.readable.getReader()
    try {
      await writePipeHeader(writer, PipeKind.Status)
      for await (const message of new FramedReader(reader).messages()) {
        return message as SessionStatus
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

  async close(): Promise<void> {
    if (this.closed && !this.transport) {
      return
    }
    this.closed = true
    this.lifetime?.abort()
    this.lifetime = null

    for (const [, pending] of this.pendingEval) {
      pending.reject(new Error('Data plane closed'))
    }
    this.pendingEval.clear()

    await closeWriter(this.consoleInput)
    this.consoleInput = null
    this.consoleInputWriteChain = Promise.resolve()

    const transport = this.transport
    this.transport = null
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

  private async openBidirectionalWriter(
    kind: number,
  ): Promise<WritableStreamDefaultWriter<Uint8Array>> {
    const transport = this.requireTransport()
    const stream = await transport.createBidirectionalStream()
    const writer = stream.writable.getWriter()
    await writePipeHeader(writer, kind)
    await writer.ready
    // JsBridge-disabled rejections come back on this duplex; live eval results
    // also arrive on the console output pipe.
    void this.pumpDuplexResponses(stream.readable.getReader())
    return writer
  }

  private async pumpDuplexResponses(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    try {
      for await (const message of new FramedReader(reader).messages()) {
        this.onConsole(message as SessionConsoleOutput)
      }
    } catch {
      // stream ended
    }
  }

  private pumpIncoming(): void {
    const transport = this.transport
    const signal = this.lifetime?.signal
    if (!transport || !signal) {
      return
    }

    void (async () => {
      const reader = transport.incomingUnidirectionalStreams.getReader()
      try {
        while (!signal.aborted) {
          const { value: stream, done } = await reader.read()
          if (done || !stream) {
            break
          }
          void this.handleIncoming(stream as ReadableStream<Uint8Array>)
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

  private async handleIncoming(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    try {
      const framed = new FramedReader(reader)
      const kind = await framed.readPipeKind()
      if (kind == null) {
        return
      }

      for await (const message of framed.messages()) {
        switch (kind) {
          case PipeKind.Frame:
            this.emit('frame', message as SessionEventMap['frame'])
            break
          case PipeKind.ConsoleOutput:
            this.onConsole(message as SessionConsoleOutput)
            break
          case PipeKind.Notification:
            this.emit('notification', message as SessionEventMap['notification'])
            break
          default:
            break
        }
      }
    } catch (error) {
      if (!this.closed) {
        this.emit('error', error)
      }
    } finally {
      reader.releaseLock()
    }
  }

  private onConsole(message: SessionConsoleOutput): void {
    this.emit('console', message)
    if (message?.kind !== ConsoleOutputKind.EvalResult || message.requestId == null) {
      return
    }
    const requestId = Number(message.requestId)
    const pending = this.pendingEval.get(requestId)
    if (!pending) {
      return
    }
    this.pendingEval.delete(requestId)
    pending.resolve({
      requestId,
      ok: Boolean(message.ok),
      value: message.value,
      error: message.error,
    })
  }

  private watchClosed(): void {
    const transport = this.transport
    if (!transport) {
      return
    }
    void transport.closed.then(
      () => this.close(),
      () => this.close(),
    )
  }

  private requireTransport(): WebTransport {
    if (!this.transport) {
      throw new Error('Data plane is not open')
    }
    return this.transport
  }
}

function buildTransportUrl(
  baseUrl: string,
  path: string,
  sessionId: string,
  token: string,
): string {
  const url = new URL(path, resolveOrigin(baseUrl))
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('token', token)
  return url.toString()
}

function resolveOrigin(baseUrl: string): string {
  if (!baseUrl) {
    return location.origin
  }
  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  }
  return `${new URL(baseUrl, location.origin).origin}/`
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms)
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

/**
 * Loads the SHA-256 pin published by the API when
 * SPECULUM_WEBTRANSPORT_PORT is enabled. Missing endpoint → undefined (PKI path).
 */
async function fetchServerCertificateHashes(
  hubBaseUrl: string,
): Promise<WebTransportHash[] | undefined> {
  try {
    const response = await fetch(new URL('/health/webtransport-cert', resolveOrigin(hubBaseUrl)), {
      credentials: 'omit',
    })
    if (!response.ok) {
      return undefined
    }
    const body = (await response.json()) as { algorithm?: string; sha256?: string }
    if (!body.sha256 || (body.algorithm && body.algorithm !== 'sha-256')) {
      return undefined
    }
    const binary = Uint8Array.from(atob(body.sha256), (c) => c.charCodeAt(0))
    return [{ algorithm: 'sha-256', value: binary.buffer }]
  } catch {
    return undefined
  }
}

async function closeWriter(
  writer: WritableStreamDefaultWriter<Uint8Array> | null,
): Promise<void> {
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
