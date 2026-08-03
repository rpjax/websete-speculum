import { DefaultStreamPath, type PipeKindValue } from './constants'
import {
  DataStreamMuxOp,
  DATA_STREAM_MUX_SERVER_ID_BASE,
  encodeMuxClose,
  encodeMuxData,
  encodeMuxOpen,
  tryParseMuxFrame,
} from './dataStreamMux'
import type {
  DataStreamPipe,
  DataStreamTransport,
  DataStreamTransportConnectOptions,
} from './dataStreamTransport'
import { writePipeHeader } from './framing'

interface MuxPipeState {
  streamId: number
  inbound: ReadableStreamDefaultController<Uint8Array> | null
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}

/**
 * WebSocket mux carrier for {@link DataStreamTransport}.
 * One socket; OPEN/DATA/CLOSE demux by streamId (matches API DataStreamMux).
 */
export class WebSocketDataStreamTransport implements DataStreamTransport {
  private socket: WebSocket | null = null
  private nextStreamId = 1
  private readonly pipes = new Map<number, MuxPipeState>()
  private incomingWaiters: Array<(pipe: DataStreamPipe) => void> = []
  private incomingQueue: DataStreamPipe[] = []
  private closedPromise: Promise<void> = Promise.resolve()
  private resolveClosed: (() => void) | null = null
  private sendChain: Promise<void> = Promise.resolve()

  async connect(opts: DataStreamTransportConnectOptions): Promise<void> {
    await this.close()

    const path = opts.path || DefaultStreamPath
    const url = buildWebSocketUrl(opts.baseUrl ?? '', path, opts.sessionId, opts.token)
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'

    this.closedPromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve
    })

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup()
        try {
          socket.close()
        } catch {
          // ignore
        }
        reject(new Error('WebSocket data stream ready timed out'))
      }, 15_000)

      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error('WebSocket data stream failed to connect'))
      }
      const cleanup = () => {
        window.clearTimeout(timer)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
      }
      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
    })

    this.socket = socket
    socket.addEventListener('message', (event) => this.onMessage(event))
    socket.addEventListener('close', () => this.onSocketClosed())
    socket.addEventListener('error', () => this.onSocketClosed())
  }

  async openPipe(kind: PipeKindValue): Promise<DataStreamPipe> {
    this.requireSocket()
    if (this.nextStreamId >= DATA_STREAM_MUX_SERVER_ID_BASE) {
      throw new Error('WebSocket mux stream id space exhausted')
    }
    const streamId = this.nextStreamId++
    const state = this.createPipeState(streamId)
    this.pipes.set(streamId, state)
    await this.send(encodeMuxOpen(streamId))
    const writer = state.writable.getWriter()
    await writePipeHeader(writer, kind)
    await writer.ready
    writer.releaseLock()
    return {
      kind,
      readable: state.readable,
      writable: state.writable,
    }
  }

  async *acceptIncoming(signal: AbortSignal): AsyncIterable<DataStreamPipe> {
    while (!signal.aborted) {
      if (this.incomingQueue.length > 0) {
        yield this.incomingQueue.shift()!
        continue
      }
      const pipe = await new Promise<DataStreamPipe | null>((resolve) => {
        if (signal.aborted) {
          resolve(null)
          return
        }
        const onAbort = () => {
          const index = this.incomingWaiters.indexOf(waiter)
          if (index >= 0) {
            this.incomingWaiters.splice(index, 1)
          }
          resolve(null)
        }
        const waiter = (next: DataStreamPipe) => {
          signal.removeEventListener('abort', onAbort)
          resolve(next)
        }
        this.incomingWaiters.push(waiter)
        signal.addEventListener('abort', onAbort, { once: true })
      })
      if (!pipe) {
        return
      }
      yield pipe
    }
  }

  async close(): Promise<void> {
    const socket = this.socket
    this.socket = null
    this.incomingWaiters = []
    this.incomingQueue = []
    for (const state of this.pipes.values()) {
      try {
        state.inbound?.close()
      } catch {
        // ignore
      }
    }
    this.pipes.clear()
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
    this.resolveClosed?.()
    this.resolveClosed = null
  }

  get closed(): Promise<void> {
    return this.closedPromise
  }

  private createPipeState(streamId: number): MuxPipeState {
    const state: MuxPipeState = {
      streamId,
      inbound: null,
      readable: null as unknown as ReadableStream<Uint8Array>,
      writable: null as unknown as WritableStream<Uint8Array>,
    }
    state.readable = new ReadableStream<Uint8Array>({
      start(controller) {
        state.inbound = controller
      },
      cancel: () => {
        void this.send(encodeMuxClose(streamId)).catch(() => {})
        this.pipes.delete(streamId)
      },
    })
    state.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await this.send(encodeMuxData(streamId, chunk))
      },
      close: async () => {
        await this.send(encodeMuxClose(streamId)).catch(() => {})
        this.pipes.delete(streamId)
      },
      abort: async () => {
        await this.send(encodeMuxClose(streamId)).catch(() => {})
        this.pipes.delete(streamId)
      },
    })
    return state
  }

  private onMessage(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) {
      return
    }
    const parsed = tryParseMuxFrame(new Uint8Array(event.data))
    if (!parsed) {
      return
    }
    const { op, streamId, payload } = parsed
    if (op === DataStreamMuxOp.Open) {
      if (streamId < DATA_STREAM_MUX_SERVER_ID_BASE || this.pipes.has(streamId)) {
        return
      }
      const state = this.createPipeState(streamId)
      this.pipes.set(streamId, state)
      this.enqueueIncoming({ readable: state.readable })
      return
    }
    if (op === DataStreamMuxOp.Data) {
      const state = this.pipes.get(streamId)
      if (!state?.inbound || payload.byteLength === 0) {
        return
      }
      state.inbound.enqueue(payload.slice())
      return
    }
    if (op === DataStreamMuxOp.Close) {
      const state = this.pipes.get(streamId)
      if (!state) {
        return
      }
      try {
        state.inbound?.close()
      } catch {
        // ignore
      }
      this.pipes.delete(streamId)
    }
  }

  private enqueueIncoming(pipe: DataStreamPipe): void {
    const waiter = this.incomingWaiters.shift()
    if (waiter) {
      waiter(pipe)
      return
    }
    this.incomingQueue.push(pipe)
  }

  private onSocketClosed(): void {
    for (const state of this.pipes.values()) {
      try {
        state.inbound?.error(new Error('WebSocket data stream closed'))
      } catch {
        // ignore
      }
    }
    this.pipes.clear()
    this.incomingWaiters = []
    this.incomingQueue = []
    this.resolveClosed?.()
    this.resolveClosed = null
  }

  private send(frame: Uint8Array): Promise<void> {
    const socket = this.requireSocket()
    const write = this.sendChain.then(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket data stream is not open')
      }
      socket.send(frame.slice())
    })
    this.sendChain = write.then(
      () => undefined,
      () => undefined,
    )
    return write
  }

  private requireSocket(): WebSocket {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket data stream is not connected')
    }
    return this.socket
  }
}

function buildWebSocketUrl(
  baseUrl: string,
  path: string,
  sessionId: string,
  token: string,
): string {
  const httpUrl = new URL(path, resolveOrigin(baseUrl))
  httpUrl.searchParams.set('sessionId', sessionId)
  httpUrl.searchParams.set('token', token)
  const protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${httpUrl.host}${httpUrl.pathname}${httpUrl.search}`
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
