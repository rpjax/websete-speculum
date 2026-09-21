import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { looksLikeAsset } from '../src/shared/sweep.ts'
import { extractUrls, isTextual } from '../src/shared/sweep.ts'

const id = 'sess-2026-09-03T07-24-39'
const dir = join('.imago/sessions', id)

let imgOk = 0
let imgFail = 0
for (const f of readdirSync(join(dir, 'network')).filter((x) => x.endsWith('.json'))) {
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  if (!r.resolvedAtClose || !r.url.includes('imgproxy')) continue
  if (r.responseBodyHash) imgOk++
  else imgFail++
}
console.log('imgproxy resolved ok', imgOk, 'fail', imgFail)

// how many extracted urls are NOT asset-shaped?
let total = 0
let asset = 0
let hub = 0
for (const f of readdirSync(join(dir, 'network')).filter((x) => x.endsWith('.json'))) {
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  if (!r.responseBodyHash) continue
  const ct = r.responseHeaders?.['content-type'] ?? ''
  if (!isTextual(ct)) continue
  const text = readFileSync(join(dir, 'blobs', r.responseBodyHash), 'utf8')
  for (const u of extractUrls(text)) {
    total++
    if (looksLikeAsset(u)) asset++
    if (u.includes('www.eneba.com/hub')) hub++
  }
}
console.log('extracted urls', total, 'asset-shaped', asset, 'hub links', hub)
