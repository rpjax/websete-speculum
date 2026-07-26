import FrameWorker from './frame-decode.worker?worker'
import { extractJpegBytes, shouldAcceptFrameSeq } from './frameSeq'
import type { FramePayload, MotorElements } from './types'

export class MotorScreencast {
  private frameWorker: Worker | null = null
  private latestDrawnSeq = 0
  private fpsFrames = 0
  private fpsLastTs = performance.now()
  private elements: MotorElements | null = null
  private onFps: ((fps: number) => void) | null = null

  attach(elements: MotorElements, onFps: (fps: number) => void) {
    this.elements = elements
    this.onFps = onFps
  }

  detach() {
    this.teardown()
    this.elements = null
    this.onFps = null
  }

  teardown() {
    this.frameWorker?.terminate()
    this.frameWorker = null
    this.latestDrawnSeq = 0
    this.fpsFrames = 0
    this.fpsLastTs = performance.now()
  }

  onFrame(frame: FramePayload) {
    const jpeg = extractJpegBytes(frame as FramePayload & { Jpeg?: Uint8Array | number[] })
    if (!jpeg?.length || !this.elements) return
    const seq = frame.sequence ?? 0
    if (!shouldAcceptFrameSeq(seq, this.latestDrawnSeq)) return
    this.ensureFrameWorker()
    const buf = jpeg instanceof Uint8Array
      ? jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength)
      : new Uint8Array(jpeg).buffer
    this.frameWorker?.postMessage({ seq, jpeg: buf }, [buf])
  }

  private ensureFrameWorker() {
    if (this.frameWorker || !this.elements) return
    this.frameWorker = new FrameWorker()
    const ctx = this.elements.canvas.getContext('2d')
    if (!ctx) return
    this.frameWorker.onmessage = (ev: MessageEvent<{ seq: number; bitmap?: ImageBitmap; error?: string }>) => {
      const { seq, bitmap, error } = ev.data
      if (error) {
        console.warn('[frame] JPEG decode error', error)
        return
      }
      if (!bitmap || seq < this.latestDrawnSeq) {
        bitmap?.close()
        return
      }
      this.latestDrawnSeq = seq
      ctx.drawImage(bitmap, 0, 0, this.elements!.canvas.width, this.elements!.canvas.height)
      bitmap.close()
      this.tickFps()
    }
  }

  private tickFps() {
    const host = location.hostname
    const isDev = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')
    if (!isDev) return
    this.fpsFrames++
    const now = performance.now()
    const elapsed = now - this.fpsLastTs
    if (elapsed >= 1000) {
      const fps = Math.round(this.fpsFrames * 1000 / elapsed)
      this.onFps?.(fps)
      this.fpsFrames = 0
      this.fpsLastTs = now
    }
  }
}
