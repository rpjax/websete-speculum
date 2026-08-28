interface PendingFrame {
  seq: number
  jpeg: ArrayBuffer
}

let latestSeq = 0
let decoding = false
let pending: PendingFrame | null = null

async function decodeLatest() {
  if (decoding) return
  decoding = true

  try {
    while (pending) {
      const frame = pending
      pending = null

      try {
        const bitmap = await createImageBitmap(new Blob([frame.jpeg], { type: 'image/jpeg' }))
        if (frame.seq < latestSeq) {
          bitmap.close()
          continue
        }
        self.postMessage({ seq: frame.seq, bitmap }, { transfer: [bitmap] })
      } catch (err: unknown) {
        if (frame.seq >= latestSeq) {
          self.postMessage({ seq: frame.seq, error: String(err) })
        }
      }
    }
  } finally {
    decoding = false
    if (pending) void decodeLatest()
  }
}

self.onmessage = (ev: MessageEvent<PendingFrame>) => {
  const { seq, jpeg } = ev.data
  if (typeof seq !== 'number' || !(jpeg instanceof ArrayBuffer)) return
  if (seq < latestSeq) return

  latestSeq = seq
  pending = { seq, jpeg }
  void decodeLatest()
}

export {}
