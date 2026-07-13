/** Pure helper: drop stale screencast frames by sequence number. */
export function shouldAcceptFrameSeq(seq: number, latestDrawnSeq: number): boolean {
  return seq >= latestDrawnSeq
}

export function extractJpegBytes(
  frame: { jpeg?: Uint8Array | number[]; Jpeg?: Uint8Array | number[] },
): Uint8Array | number[] | undefined {
  return frame.jpeg ?? frame.Jpeg
}
