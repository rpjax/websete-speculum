import { encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import { PipeKind } from './constants'
import type { DataStreamPipe, DataStreamTransport } from './dataStreamTransport'
import { DataStreams } from './dataStreams'
import { FramedReader, writePipeHeader } from './framing'
import type { PageProjectionDiff, SessionEventMap } from './types'

/** Captures bytes written to client→server pipes after the PipeKind header. */
class MockDataStreamTransport implements DataStreamTransport {
  readonly pipes = new Map<number, Uint8Array[]>()

  async connect(): Promise<void> {
    // no-op
  }

  async openPipe(kind: number): Promise<DataStreamPipe> {
    const chunks: Uint8Array[] = []
    this.pipes.set(kind, chunks)
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk.slice())
      },
    })
    const writer = writable.getWriter()
    await writePipeHeader(writer, kind)
    await writer.ready
    writer.releaseLock()
    return { kind: kind as DataStreamPipe['kind'], writable }
  }

  async *acceptIncoming(signal: AbortSignal): AsyncIterable<DataStreamPipe> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }

  async close(): Promise<void> {
    // no-op
  }
}

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

/** Big-endian length-prefixed MessagePack frame, matching {@link writeMessage}. */
function encodeFramedMessage(value: unknown): Uint8Array {
  const payload = encode(value)
  const frame = new Uint8Array(4 + payload.byteLength)
  new DataView(frame.buffer).setInt32(0, payload.byteLength, false)
  frame.set(payload, 4)
  return frame
}

/** Mock transport that can push one server→client pipe (kind byte + framed messages). */
class MockIncomingTransport implements DataStreamTransport {
  private queued: DataStreamPipe[] = []
  private wake: (() => void) | null = null

  async connect(): Promise<void> {
    // no-op
  }

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

  async close(): Promise<void> {
    // no-op
  }
}

/** Awaits the next detail from one {@link DataStreams} event, or throws after `timeoutMs`. */
function nextEvent<K extends keyof SessionEventMap & string>(
  streams: DataStreams,
  type: K,
  timeoutMs = 1000,
): Promise<SessionEventMap[K]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for '${type}'`)), timeoutMs)
    const off = streams.on(type, (detail) => {
      clearTimeout(timer)
      off()
      resolve(detail)
    })
  })
}

describe('DataStreams.sendInput', () => {
  it('writes PipeKind.VideoStreamingInput header then a framed type/payload message', async () => {
    const transport = new MockDataStreamTransport()
    const streams = new DataStreams({
      sessionId: '00000000-0000-0000-0000-000000000001',
      token: 'test-token',
      transport,
    })

    await streams.open()
    await streams.sendInput({ type: 'mousedown', x: 10, y: 20, button: 0 })

    const chunks = transport.pipes.get(PipeKind.VideoStreamingInput)
    expect(chunks).toBeDefined()
    const bytes = concat(chunks!)
    expect(bytes[0]).toBe(PipeKind.VideoStreamingInput)

    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(1))
        controller.close()
      },
    }).getReader()
    const framed = new FramedReader(reader)
    const messages: unknown[] = []
    for await (const message of framed.messages()) {
      messages.push(message)
    }

    expect(messages).toHaveLength(1)
    const msg = messages[0] as {
      type: string
      payload: string
      traceId: string
      clientTimestampMs: number
    }
    expect(msg.type).toBe('mousedown')
    expect(JSON.parse(msg.payload)).toEqual({
      type: 'mousedown',
      x: 10,
      y: 20,
      button: 0,
    })
    expect(typeof msg.traceId).toBe('string')
    expect(msg.traceId.length).toBeGreaterThan(8)
    expect(typeof msg.clientTimestampMs).toBe('number')

    await streams.close()
  })

  it('stamps caller-supplied traceId on VideoStreamingInput', async () => {
    const transport = new MockDataStreamTransport()
    const streams = new DataStreams({
      sessionId: '00000000-0000-0000-0000-000000000011',
      token: 'test-token',
      transport,
    })

    await streams.open()
    await streams.sendInput({
      type: 'mousedown',
      x: 1,
      y: 2,
      button: 0,
      traceId: 'fixedtraceid01',
      clientTimestampMs: 42,
    })

    const chunks = transport.pipes.get(PipeKind.VideoStreamingInput)
    const bytes = concat(chunks!)
    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(1))
        controller.close()
      },
    }).getReader()
    const framed = new FramedReader(reader)
    const messages: unknown[] = []
    for await (const message of framed.messages()) {
      messages.push(message)
    }
    const msg = messages[0] as { traceId: string; clientTimestampMs: number }
    expect(msg.traceId).toBe('fixedtraceid01')
    expect(msg.clientTimestampMs).toBe(42)

    await streams.close()
  })

  it('opens PageProjectionIntent only in PageProjection mode', async () => {
    const transport = new MockDataStreamTransport()
    const streams = new DataStreams({
      sessionId: '00000000-0000-0000-0000-000000000002',
      token: 'test-token',
      mirrorMode: 'pageProjection',
      transport,
    })

    await streams.open()
    expect(transport.pipes.has(PipeKind.VideoStreamingInput)).toBe(false)
    expect(transport.pipes.has(PipeKind.PageProjectionIntent)).toBe(true)

    await streams.sendPageProjectionIntent({
      type: 'mousedown',
      anchor: 'a1',
      generation: 1,
      payload: JSON.stringify({ x: 10, y: 20, button: 0 }),
    })

    const chunks = transport.pipes.get(PipeKind.PageProjectionIntent)
    expect(chunks).toBeDefined()
    const bytes = concat(chunks!)
    expect(bytes[0]).toBe(PipeKind.PageProjectionIntent)

    await expect(
      streams.sendInput({ type: 'mousedown', x: 1, y: 2, button: 0 }),
    ).rejects.toThrow(/VideoStreamingInput is not available/)

    await streams.close()
  })

  it('stamps targetId on PageProjectionIntent (§5.11 id-addressed input)', async () => {
    const transport = new MockDataStreamTransport()
    const streams = new DataStreams({
      sessionId: '00000000-0000-0000-0000-000000000012',
      token: 'test-token',
      mirrorMode: 'pageProjection',
      transport,
    })

    await streams.open()
    await streams.sendPageProjectionIntent({
      type: 'mousedown',
      targetId: 42,
      generation: 1,
      payload: JSON.stringify({ x: 10, y: 20, button: 0 }),
    })

    const chunks = transport.pipes.get(PipeKind.PageProjectionIntent)
    const bytes = concat(chunks!)
    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(1))
        controller.close()
      },
    }).getReader()
    const framed = new FramedReader(reader)
    const messages: unknown[] = []
    for await (const message of framed.messages()) {
      messages.push(message)
    }
    const msg = messages[0] as { targetId: number | null; anchor: string | null }
    expect(msg.targetId).toBe(42)
    expect(msg.anchor).toBeNull()

    await streams.close()
  })
})

describe('DataStreams pageProjectionDiff normalize', () => {
  it('accepts a V2 binary frame (empty plane/operation, body present)', async () => {
    const transport = new MockIncomingTransport()
    const streams = new DataStreams({
      sessionId: '00000000-0000-0000-0000-000000000021',
      token: 'test-token',
      mirrorMode: 'pageProjection',
      transport,
    })
    await streams.open()

    const pending = nextEvent(streams, 'pageProjectionDiff')
    transport.pushIncoming(PipeKind.PageProjectionDiff, [
      {
        sequence: 7,
        generation: 2,
        timestamp: 123,
        plane: '',
        operation: '',
        body: Uint8Array.of(1, 2, 3, 4),
        partIndex: 0,
        partCount: 1,
        flags: 0b01,
        version: 2,
      },
    ])

    const diff = (await pending) as PageProjectionDiff
    expect(diff.plane).toBe('')
    expect(diff.operation).toBe('')
    expect(diff.body).toBeInstanceOf(Uint8Array)
    expect(Array.from(diff.body as Uint8Array)).toEqual([1, 2, 3, 4])
    expect(diff.sequence).toBe(7)
    expect(diff.generation).toBe(2)
    expect(diff.partIndex).toBe(0)
    expect(diff.partCount).toBe(1)
    expect(diff.flags).toBe(0b01)
    expect(diff.version).toBe(2)

    await streams.close()
  })

  it('rejects an empty envelope (empty plane/operation, no body) as missing_body', async () => {
    const transport = new MockIncomingTransport()
    const streams = new DataStreams({
      sessionId: '00000000-0000-0000-0000-000000000022',
      token: 'test-token',
      mirrorMode: 'pageProjection',
      transport,
    })
    await streams.open()

    const pending = nextEvent(streams, 'pageProjectionDiffRejected')
    transport.pushIncoming(PipeKind.PageProjectionDiff, [
      { sequence: 1, generation: 1, timestamp: 1, plane: '', operation: '' },
    ])

    const rejected = await pending
    expect(rejected.reason).toBe('missing_body')

    await streams.close()
  })

  it('still decodes a legacy V1 JSON-body diff (plane dom, operation scrollViewport)', async () => {
    const transport = new MockIncomingTransport()
    const streams = new DataStreams({
      sessionId: '00000000-0000-0000-0000-000000000023',
      token: 'test-token',
      mirrorMode: 'pageProjection',
      transport,
    })
    await streams.open()

    const pending = nextEvent(streams, 'pageProjectionDiff')
    transport.pushIncoming(PipeKind.PageProjectionDiff, [
      {
        sequence: 9,
        generation: 1,
        timestamp: 1,
        plane: 'dom',
        operation: 'scrollViewport',
        scrollViewport: { scrollX: 10, scrollY: 20 },
      },
    ])

    const diff = (await pending) as PageProjectionDiff
    expect(diff.plane).toBe('dom')
    expect(diff.operation).toBe('scrollViewport')
    expect(diff.body).toBeUndefined()
    expect(diff.scrollViewport).toEqual({ scrollX: 10, scrollY: 20 })

    await streams.close()
  })
})
