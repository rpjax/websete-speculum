import { encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import { FramedReader } from './framing'

function frame(value: unknown): Uint8Array {
  const payload = encode(value)
  const bytes = new Uint8Array(4 + payload.byteLength)
  new DataView(bytes.buffer).setInt32(0, payload.byteLength, false)
  bytes.set(payload, 4)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

function readerOf(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  }).getReader()
}

async function collect(reader: FramedReader): Promise<unknown[]> {
  const messages: unknown[] = []
  for await (const message of reader.messages()) {
    messages.push(message)
  }
  return messages
}

describe('FramedReader', () => {
  it('keeps framing when the pipe-kind byte arrives in the same chunk as messages', async () => {
    const chunk = concat(Uint8Array.of(1), frame({ sequence: 1 }), frame({ sequence: 2 }))
    const framed = new FramedReader(readerOf([chunk]))

    expect(await framed.readPipeKind()).toBe(1)
    expect(await collect(framed)).toEqual([{ sequence: 1 }, { sequence: 2 }])
  })

  it('reassembles messages split across chunk boundaries', async () => {
    const bytes = concat(Uint8Array.of(3), frame({ kind: 'notification' }))
    const chunks = [bytes.subarray(0, 2), bytes.subarray(2, 6), bytes.subarray(6)]
    const framed = new FramedReader(readerOf(chunks.map((chunk) => chunk.slice())))

    expect(await framed.readPipeKind()).toBe(3)
    expect(await collect(framed)).toEqual([{ kind: 'notification' }])
  })

  it('rejects a non-positive framed length', async () => {
    const header = new Uint8Array(4)
    new DataView(header.buffer).setInt32(0, -2_086_376_848, false)
    const framed = new FramedReader(readerOf([header]))

    await expect(collect(framed)).rejects.toThrow(/Invalid framed length/)
  })
})
