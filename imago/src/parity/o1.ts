import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import type { O1Result } from './types.js'

const MAX_DIFF_PCT = 0.1
const MAX_REGION_PX = 32

export function compareScreenshots(referencePath: string, candidatePath: string, diffPath?: string): O1Result {
  const ref = PNG.sync.read(readFileSync(referencePath))
  const cand = PNG.sync.read(readFileSync(candidatePath))

  if (ref.width !== cand.width || ref.height !== cand.height) {
    return {
      pass: false,
      skipped: false,
      reason: `viewport mismatch: reference ${ref.width}x${ref.height}, candidate ${cand.width}x${cand.height}`,
    }
  }

  const { width, height } = ref
  const diff = new PNG({ width, height })
  const diffPixels = pixelmatch(ref.data, cand.data, diff.data, width, height, { threshold: 0.1 })
  const totalPixels = width * height
  const differPct = (diffPixels / totalPixels) * 100
  const maxRegion = largestDiffRegion(diff.data, width, height)

  if (diffPath) {
    writeFileSync(diffPath, PNG.sync.write(diff))
  }

  const pass = differPct <= MAX_DIFF_PCT && maxRegion.w <= MAX_REGION_PX && maxRegion.h <= MAX_REGION_PX
  return { pass, skipped: false, differPct, diffPixels, totalPixels, maxRegion }
}

/** Largest axis-aligned bounding box of differing pixels in the diff image. */
function largestDiffRegion(data: Buffer, width: number, height: number): { w: number; h: number } {
  let minX = width, minY = height, maxX = 0, maxY = 0
  let any = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) * 4
      if (data[i]! > 0 || data[i + 1]! > 0 || data[i + 2]! > 0) {
        any = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (!any) return { w: 0, h: 0 }
  return { w: maxX - minX + 1, h: maxY - minY + 1 }
}
