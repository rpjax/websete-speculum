import { decode, encode } from '@msgpack/msgpack'
import { MaxMessageBytes } from './constants'

/** Writes one SessionPipeKind byte before any framed message. */
export async function writePipeHeader(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  kind: number,
): Promise<void> {
  await writer.write(Uint8Array.of(kind & 0xff))
}

/** Writes one big-endian length-prefixed MessagePack message as a single chunk. */
export async function writeMessage(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  value: unknown,
): Promise<void> {
  const payload = encode(value)
  if (payload.byteLength <= 0 || payload.byteLength > MaxMessageBytes) {
    throw new Error(`Message size out of range: ${payload.byteLength}`)
  }
  const frame = new Uint8Array(4 + payload.byteLength)
  new DataView(frame.buffer).setInt32(0, payload.byteLength, false)
  frame.set(payload, 4)
  await writer.write(frame)
}

/**
 * Reads one stream: optional leading pipe-kind byte, then big-endian
 * length-prefixed MessagePack messages.
 *
 * A single instance owns the read-ahead buffer, so bytes pulled while reading
 * the pipe-kind byte stay available to {@link messages} — reading the header and
 * the frames through separate buffers loses them and desynchronises framing.
 */
export class FramedReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private pending = new Uint8Array(0)

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader
  }

  /** Reads the leading pipe-kind byte, or null when the stream ended. */
  async readPipeKind(): Promise<number | null> {
    const bytes = await this.readExact(1)
    return bytes ? bytes[0]! : null
  }

  async *messages(): AsyncGenerator<unknown> {
    for (;;) {
      const lengthBytes = await this.readExact(4)
      if (!lengthBytes) {
        return
      }
      const length = new DataView(
        lengthBytes.buffer,
        lengthBytes.byteOffset,
        lengthBytes.byteLength,
      ).getInt32(0, false)
      if (length <= 0 || length > MaxMessageBytes) {
        throw new Error(`Invalid framed length: ${length}`)
      }
      const payload = await this.readExact(length)
      if (!payload) {
        return
      }
      yield decode(payload)
    }
  }

  private async readExact(length: number): Promise<Uint8Array | null> {
    while (this.pending.byteLength < length) {
      const { value, done } = await this.reader.read()
      if (done) {
        return null
      }
      if (!value || value.byteLength === 0) {
        continue
      }
      const next = new Uint8Array(this.pending.byteLength + value.byteLength)
      next.set(this.pending, 0)
      next.set(value, this.pending.byteLength)
      this.pending = next
    }

    const slice = this.pending.subarray(0, length)
    this.pending = this.pending.subarray(length)
    return slice.slice()
  }
}
