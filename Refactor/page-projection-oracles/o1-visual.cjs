/**
 * O1 — Visual diff Virtual vs Projected (redesign §7).
 * Asserts P7: ≤0.5% differing pixels AND zero structural regions.
 * Structural region: connected differing region ≥2% of viewport, OR text on one side only.
 */
'use strict'

const { PNG } = require('pngjs')
const pixelmatch = require('pixelmatch').default || require('pixelmatch')
const { parity } = require('./budgets.cjs')

/**
 * @param {Buffer} virtualPng
 * @param {Buffer} projectedPng
 * @param {{ structuralTextOnlyRegions?: number }} [opts]
 * @returns {{ ok: boolean, results: import('./budgets.cjs').GateResult[], diffPct: number, structuralRegions: number }}
 */
function compareStillPair(virtualPng, projectedPng, opts = {}) {
  const v = PNG.sync.read(virtualPng)
  const p = PNG.sync.read(projectedPng)
  const results = []

  if (v.width !== p.width || v.height !== p.height) {
    results.push({
      id: 'O1.size',
      ok: false,
      detail: `viewport mismatch Virtual ${v.width}x${v.height} vs Projected ${p.width}x${p.height}`,
    })
    return { ok: false, results, diffPct: 100, structuralRegions: 1 }
  }

  const { width, height } = v
  const diff = new PNG({ width, height })
  const mismatched = pixelmatch(v.data, p.data, diff.data, width, height, {
    // Speculum Chrome Virtual vs Playwright iframe Projected: raise threshold slightly
    // so subpixel font rasterization is not counted as a structural miss.
    threshold: 0.25,
    includeAA: false,
    // Only paint mismatches — grayscale “same” pixels must not inflate structural regions.
    diffMask: true,
  })
  const total = width * height
  const diffPct = total === 0 ? 0 : (mismatched / total) * 100

  const pixelOk = diffPct <= parity.P7_pixelDiffPct
  results.push({
    id: 'P7.pixelPct',
    ok: pixelOk,
    measured: Number(diffPct.toFixed(4)),
    target: `≤ ${parity.P7_pixelDiffPct}%`,
  })

  const structuralRegions = countStructuralRegions(diff.data, width, height, mismatched)
  const textOnly = opts.structuralTextOnlyRegions || 0
  const structCount = structuralRegions + textOnly
  const structOk = structCount === 0
  results.push({
    id: 'P7.structuralRegions',
    ok: structOk,
    measured: structCount,
    target: '0',
    detail:
      structuralRegions > 0
        ? `connected differing regions ≥${parity.P7_structuralRegionViewportPct}% viewport: ${structuralRegions}`
        : textOnly > 0
          ? `text-only-one-side regions: ${textOnly}`
          : undefined,
  })

  return { ok: pixelOk && structOk, results, diffPct, structuralRegions: structCount, diffPng: PNG.sync.write(diff) }
}

/**
 * Flood-fill connected components of differing pixels; count those covering ≥2% viewport.
 * @param {Uint8Array} diffRgba
 */
function countStructuralRegions(diffRgba, width, height, mismatchedHint) {
  if (mismatchedHint === 0) return 0
  const visited = new Uint8Array(width * height)
  const thresholdArea = Math.ceil((width * height * parity.P7_structuralRegionViewportPct) / 100)
  let regions = 0

  const isDiff = (i) => {
    const o = i * 4
    // pixelmatch marks diffs with non-zero alpha in red channel typically; treat any non-zero RGB as diff
    return diffRgba[o] !== 0 || diffRgba[o + 1] !== 0 || diffRgba[o + 2] !== 0
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x
      if (visited[start] || !isDiff(start)) continue
      let area = 0
      const stack = [start]
      visited[start] = 1
      while (stack.length) {
        const i = stack.pop()
        area++
        const cx = i % width
        const cy = (i / width) | 0
        const neighbors = [
          cy > 0 ? i - width : -1,
          cy + 1 < height ? i + width : -1,
          cx > 0 ? i - 1 : -1,
          cx + 1 < width ? i + 1 : -1,
        ]
        for (const n of neighbors) {
          if (n < 0 || visited[n] || !isDiff(n)) continue
          visited[n] = 1
          stack.push(n)
        }
      }
      if (area >= thresholdArea) regions++
    }
  }
  return regions
}

module.exports = { compareStillPair, countStructuralRegions }
