import { encode, decode } from '@msgpack/msgpack'

const MAX_MESSAGE_BYTES = 1024 * 1024

/**
 * Writes one SessionPipeKind byte then length-prefixed MessagePack messages.
 * @param {WritableStreamDefaultWriter<Uint8Array>} writer
 * @param {number} kind
 */
export async function writePipeHeader(writer, kind) {
  await writer.write(Uint8Array.of(kind & 0xff))
}

/**
 * @param {WritableStreamDefaultWriter<Uint8Array>} writer
 * @param {unknown} value
 */
export async function writeMessage(writer, value) {
  const payload = encode(value)
  if (payload.byteLength <= 0 || payload.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error(`Message size out of range: ${payload.byteLength}`)
  }
  const header = new Uint8Array(4)
  new DataView(header.buffer).setInt32(0, payload.byteLength, false)
  await writer.write(header)
  await writer.write(payload)
}

/**
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @returns {AsyncGenerator<unknown>}
 */
export async function* readMessages(reader) {
  const buffer = new BytesBuffer()
  while (true) {
    const lengthBytes = await buffer.readExact(reader, 4)
    if (!lengthBytes) {
      return
    }
    const length = new DataView(
      lengthBytes.buffer,
      lengthBytes.byteOffset,
      lengthBytes.byteLength,
    ).getInt32(0, false)
    if (length <= 0 || length > MAX_MESSAGE_BYTES) {
      throw new Error(`Invalid framed length: ${length}`)
    }
    const payload = await buffer.readExact(reader, length)
    if (!payload) {
      return
    }
    yield decode(payload)
  }
}

/**
 * Reads the leading pipe-kind byte from an incoming stream.
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @returns {Promise<number|null>}
 */
export async function readPipeKind(reader) {
  const buffer = new BytesBuffer()
  const bytes = await buffer.readExact(reader, 1)
  return bytes ? bytes[0] : null
}

class BytesBuffer {
  constructor() {
    /** @type {Uint8Array} */
    this._pending = new Uint8Array(0)
  }

  /**
   * @param {ReadableStreamDefaultReader<Uint8Array>} reader
   * @param {number} length
   * @returns {Promise<Uint8Array|null>}
   */
  async readExact(reader, length) {
    while (this._pending.byteLength < length) {
      const { value, done } = await reader.read()
      if (done) {
        return null
      }
      if (!value || value.byteLength === 0) {
        continue
      }
      const next = new Uint8Array(this._pending.byteLength + value.byteLength)
      next.set(this._pending, 0)
      next.set(value, this._pending.byteLength)
      this._pending = next
    }

    const slice = this._pending.subarray(0, length)
    this._pending = this._pending.subarray(length)
    return slice.slice()
  }
}
