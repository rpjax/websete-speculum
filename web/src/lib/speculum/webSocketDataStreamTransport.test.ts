import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_STREAM_MUX_SERVER_ID_BASE, encodeMuxOpen } from './dataStreamMux'
import { WebSocketDataStreamTransport } from './webSocketDataStreamTransport'

type Listener = (event: unknown) => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  binaryType = 'arraybuffer'
  readonly url: string
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener)
  }

  send() {}

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', {})
  }

  openNow() {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open', {})
  }

  pushBinary(bytes: Uint8Array) {
    const copy = bytes.slice()
    this.emit('message', { data: copy.buffer })
  }

  private emit(type: string, event: unknown) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event)
    }
  }
}

describe('WebSocketDataStreamTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a server mux OPEN that arrives before the open handshake settles', async () => {
    const sockets: FakeWebSocket[] = []
    class StubSocket extends FakeWebSocket {
      constructor(url: string) {
        super(url)
        sockets.push(this)
      }
    }
    vi.stubGlobal('WebSocket', StubSocket)
    globalThis.WebSocket = StubSocket as unknown as typeof WebSocket

    const transport = new WebSocketDataStreamTransport()
    const connecting = transport.connect({
      baseUrl: 'http://localhost',
      path: '/w7s/vstream',
      sessionId: '2c16824f-2191-40c3-a13e-89f8f1cd152c',
      token: 'tok',
    })

    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.pushBinary(encodeMuxOpen(DATA_STREAM_MUX_SERVER_ID_BASE))
    sockets[0]!.openNow()
    await connecting

    const abort = new AbortController()
    const incoming = transport.acceptIncoming(abort.signal)[Symbol.asyncIterator]()
    const first = await incoming.next()
    expect(first.done).toBe(false)
    expect(first.value?.readable).toBeTruthy()

    abort.abort()
    await transport.close()
  })
})
