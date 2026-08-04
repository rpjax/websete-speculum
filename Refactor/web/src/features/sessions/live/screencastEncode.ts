/**
 * CSS logical viewport → screencast JPEG / canvas buffer size (mirrors sidecar).
 */
export function computeScreencastEncodeSize(args: {
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  displayWidth: number
  displayHeight: number
  maxEncodeScale: number
}): { width: number; height: number; scale: number } {
  const cssW = Math.max(1, Math.round(args.cssWidth))
  const cssH = Math.max(1, Math.round(args.cssHeight))
  const displayW = Math.max(1, Math.round(args.displayWidth))
  const displayH = Math.max(1, Math.round(args.displayHeight))

  let maxScale = Number(args.maxEncodeScale)
  if (!Number.isFinite(maxScale) || maxScale <= 0) {
    maxScale = 2
  }
  maxScale = Math.min(2, Math.max(1, maxScale))

  let dpr = Number(args.deviceScaleFactor)
  if (!Number.isFinite(dpr) || dpr < 1) {
    dpr = 1
  }

  const scale = Math.min(maxScale, dpr, displayW / cssW, displayH / cssH)
  const width = Math.max(1, Math.round(cssW * scale))
  const height = Math.max(1, Math.round(cssH * scale))
  return { width, height, scale }
}
