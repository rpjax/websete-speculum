import { encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import { PipeKind } from './constants'
import type { ControlPlane } from './control'
import type { DataStreamPipe, DataStreamTransport } from './dataStreamTransport'
import { writePipeHeader } from './framing'
import { LiveSession } from './liveSession'
import type { PageProjectionFrame } from './types'

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, part) => sum + part.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of chunks) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

function encodeFramedMessage(value: unknown): Uint8Array {
  const payload = encode(value)
  const frame = new Uint8Array(4 + payload.byteLength)
  new DataView(frame.buffer).setInt32(0, payload.byteLength, false)
  frame.set(payload, 4)
  return frame
}

class MockIncomingTransport implements DataStreamTransport {
  private queued: DataStreamPipe[] = []
  private wake: (() => void) | null = null

  async connect(): Promise<void> {}

  async openPipe(kind: number): Promise<DataStreamPipe> {
    const writable = new WritableStream<Uint8Array>({ write() {} })
    const writer = writable.getWriter()
    await writePipeHeader(writer, kind)
    await writer.ready
    writer.releaseLock()
    return { kind: kind as DataStreamPipe['kind'], writable }
  }

  pushIncoming(kind: number, messages: unknown[]): void {
    const chunks = [Uint8Array.of(kind & 0xff), ...messages.map(encodeFramedMessage)]
    const bytes = concat(chunks)
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
    this.queued.push({ readable })
    this.wake?.()
  }

  async *acceptIncoming(signal: AbortSignal): AsyncIterable<DataStreamPipe> {
    while (!signal.aborted) {
      const next = this.queued.shift()
      if (next) {
        yield next
        continue
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      this.wake = null
    }
  }

  async close(): Promise<void> {}
}

function frame(sequence: number) {
  return {
    sequence,
    generation: 1,
    timestamp: sequence,
    plane: '',
    operation: '',
    body: Uint8Array.of(sequence),
    partIndex: 0,
    partCount: 1,
    flags: sequence === 1 ? 2 : 0,
    version: 2,
  }
}

function sessionWith(transport: MockIncomingTransport): LiveSession {
  return new LiveSession({
    control: {} as unknown as ControlPlane,
    sessionId: '00000000-0000-0000-0000-000000000025',
    token: 'test-token',
    mirrorMode: 'pageProjection',
    transport,
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('LiveSession bind-before-open', () => {
  it('delivers establish frames when the listener is attached before open', async () => {
    const transport = new MockIncomingTransport()
    const session = sessionWith(transport)
    const received: number[] = []
    session.on('pageProjectionFrame', (diff: PageProjectionFrame) => {
      received.push(Number(diff.sequence))
    })
    await session.open()
    transport.pushIncoming(PipeKind.PageProjectionFrame, [frame(1)])
    await waitFor(() => received.includes(1))
    expect(received).toEqual([1])
    await session.stop({ skipHub: true })
  })

  it('drops the establish burst when open runs before any LiveSession listener', async () => {
    const transport = new MockIncomingTransport()
    const session = sessionWith(transport)
    await session.open()
    transport.pushIncoming(PipeKind.PageProjectionFrame, [frame(1)])
    await new Promise((resolve) => setTimeout(resolve, 20))

    const received: number[] = []
    session.on('pageProjectionFrame', (diff: PageProjectionFrame) => {
      received.push(Number(diff.sequence))
    })
    transport.pushIncoming(PipeKind.PageProjectionFrame, [frame(2)])
    await waitFor(() => received.includes(2))
    expect(received).toEqual([2])
    await session.stop({ skipHub: true })
  })
})
