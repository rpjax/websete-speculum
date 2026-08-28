/** Binary mux for one WebSocket data-stream session — must match API DataStreamMux. */
export const DataStreamMuxOp = {
  Open: 1,
  Data: 2,
  Close: 3,
} as const

export const DATA_STREAM_MUX_HEADER_BYTES = 3
/** Server-allocated stream ids use the high bit. */
export const DATA_STREAM_MUX_SERVER_ID_BASE = 0x8000

export function encodeMuxOpen(streamId: number): Uint8Array {
  const frame = new Uint8Array(DATA_STREAM_MUX_HEADER_BYTES)
  frame[0] = DataStreamMuxOp.Open
  new DataView(frame.buffer).setUint16(1, streamId & 0xffff, false)
  return frame
}

export function encodeMuxClose(streamId: number): Uint8Array {
  const frame = new Uint8Array(DATA_STREAM_MUX_HEADER_BYTES)
  frame[0] = DataStreamMuxOp.Close
  new DataView(frame.buffer).setUint16(1, streamId & 0xffff, false)
  return frame
}

export function encodeMuxData(streamId: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(DATA_STREAM_MUX_HEADER_BYTES + payload.byteLength)
  frame[0] = DataStreamMuxOp.Data
  new DataView(frame.buffer).setUint16(1, streamId & 0xffff, false)
  frame.set(payload, DATA_STREAM_MUX_HEADER_BYTES)
  return frame
}

export function tryParseMuxFrame(
  frame: Uint8Array,
): { op: number; streamId: number; payload: Uint8Array } | null {
  if (frame.byteLength < DATA_STREAM_MUX_HEADER_BYTES) {
    return null
  }
  const op = frame[0]!
  if (
    op !== DataStreamMuxOp.Open &&
    op !== DataStreamMuxOp.Data &&
    op !== DataStreamMuxOp.Close
  ) {
    return null
  }
  const streamId = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(1, false)
  const payload =
    frame.byteLength > DATA_STREAM_MUX_HEADER_BYTES
      ? frame.subarray(DATA_STREAM_MUX_HEADER_BYTES)
      : new Uint8Array(0)
  return { op, streamId, payload }
}
