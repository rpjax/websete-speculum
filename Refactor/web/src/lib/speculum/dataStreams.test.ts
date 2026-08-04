import { describe, expect, it } from 'vitest'
import { PipeKind } from './constants'
import type { DataStreamPipe, DataStreamTransport } from './dataStreamTransport'
import { DataStreams } from './dataStreams'
import { FramedReader, writePipeHeader } from './framing'

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
    const msg = messages[0] as { type: string; payload: string }
    expect(msg.type).toBe('mousedown')
    expect(JSON.parse(msg.payload)).toEqual({
      type: 'mousedown',
      x: 10,
      y: 20,
      button: 0,
    })

    await streams.close()
  })

  it('opens DomProjectionInput only in DomProjection mode', async () => {
    const transport = new MockDataStreamTransport()
    const streams = new DataStreams({
      sessionId: '00000000-0000-0000-0000-000000000002',
      token: 'test-token',
      mirrorMode: 'domProjection',
      transport,
    })

    await streams.open()
    expect(transport.pipes.has(PipeKind.VideoStreamingInput)).toBe(false)
    expect(transport.pipes.has(PipeKind.DomProjectionInput)).toBe(true)

    await streams.sendDomProjectionInput({
      type: 'click',
      targetId: 7,
      payload: '{}',
    })

    const chunks = transport.pipes.get(PipeKind.DomProjectionInput)
    expect(chunks).toBeDefined()
    const bytes = concat(chunks!)
    expect(bytes[0]).toBe(PipeKind.DomProjectionInput)

    await expect(
      streams.sendInput({ type: 'mousedown', x: 1, y: 2, button: 0 }),
    ).rejects.toThrow(/VideoStreamingInput is not available/)

    await streams.close()
  })
})
