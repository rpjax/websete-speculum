import { DefaultTransportPath, type PipeKindValue } from './constants'
import { writePipeHeader } from './framing'
import { appendSessionBindingQuery } from './sessionBindingAuth'
import type {
  DataStreamPipe,
  DataStreamTransport,
  DataStreamTransportConnectOptions,
} from './dataStreamTransport'

/**
 * WebTransport carrier for {@link DataStreamTransport}.
 * Dial + bi/uni pipes only — framing and domain events live in DataStreams.
 */
export class WebTransportDataStreamTransport implements DataStreamTransport {
  private transport: WebTransport | null = null
  private certificateHashBaseUrl = ''

  async connect(opts: DataStreamTransportConnectOptions): Promise<void> {
    if (typeof WebTransport !== 'function') {
      throw new Error('WebTransport is not available in this browser')
    }

    await this.close()
    this.certificateHashBaseUrl = opts.certificateHashBaseUrl ?? opts.baseUrl ?? ''

    const path = opts.path || DefaultTransportPath
    const url = buildTransportUrl(opts.baseUrl ?? '', path, opts.sessionId, opts.token)
    if (url.startsWith('http:')) {
      throw new Error(
        'WebTransport requires https (HTTP/3). Dockup lab bakes VITE_SPECULUM_TRANSPORT_ORIGIN=https://localhost:8443.',
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
  }

  async openPipe(kind: PipeKindValue): Promise<DataStreamPipe> {
    const transport = this.requireTransport()
    const stream = await transport.createBidirectionalStream()
    const writer = stream.writable.getWriter()
    await writePipeHeader(writer, kind)
    await writer.ready
    writer.releaseLock()
    return {
      kind,
      readable: stream.readable,
      writable: stream.writable,
    }
  }

  async *acceptIncoming(signal: AbortSignal): AsyncIterable<DataStreamPipe> {
    const transport = this.requireTransport()
    const reader = transport.incomingUnidirectionalStreams.getReader()
    try {
      while (!signal.aborted) {
        const { value: stream, done } = await reader.read()
        if (done || !stream) {
          break
        }
        yield { readable: stream as ReadableStream<Uint8Array> }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async close(): Promise<void> {
    const transport = this.transport
    this.transport = null
    if (!transport) {
      return
    }
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

  /** Native WT closed promise — used by DataStreams to tear down on carrier loss. */
  get closed(): Promise<WebTransportCloseInfo> | null {
    return this.transport?.closed ?? null
  }

  private requireTransport(): WebTransport {
    if (!this.transport) {
      throw new Error('Data stream transport is not connected')
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
  const url = appendSessionBindingQuery(
    new URL(path, resolveOrigin(baseUrl)),
    sessionId,
    token,
  )
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

async function fetchServerCertificateHashes(
  hubBaseUrl: string,
): Promise<WebTransportHash[] | undefined> {
  try {
    const response = await fetch(new URL('/w7s/health/webtransport-cert', resolveOrigin(hubBaseUrl)), {
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
