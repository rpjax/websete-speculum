import { describe, expect, it } from 'vitest'
import {
  DataStreamMuxOp,
  encodeMuxClose,
  encodeMuxData,
  encodeMuxOpen,
  tryParseMuxFrame,
} from './dataStreamMux'

describe('dataStreamMux', () => {
  it('round-trips OPEN / DATA / CLOSE headers', () => {
    const open = tryParseMuxFrame(encodeMuxOpen(7))
    expect(open).toEqual({
      op: DataStreamMuxOp.Open,
      streamId: 7,
      payload: new Uint8Array(0),
    })

    const payload = Uint8Array.of(4, 0, 0, 0, 1)
    const data = tryParseMuxFrame(encodeMuxData(0x8001, payload))
    expect(data?.op).toBe(DataStreamMuxOp.Data)
    expect(data?.streamId).toBe(0x8001)
    expect(Array.from(data!.payload)).toEqual([4, 0, 0, 0, 1])

    const close = tryParseMuxFrame(encodeMuxClose(0x8001))
    expect(close).toEqual({
      op: DataStreamMuxOp.Close,
      streamId: 0x8001,
      payload: new Uint8Array(0),
    })
  })

  it('rejects undersized frames', () => {
    expect(tryParseMuxFrame(Uint8Array.of(1, 0))).toBeNull()
  })
})
