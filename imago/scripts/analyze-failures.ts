import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const id = process.argv[2] ?? 'sess-2026-09-03T07-24-39'
const dir = join('.imago/sessions', id, 'network')

let resolved = 0
let ok = 0
let fail = 0
const byErr = new Map<string, number>()
const byHost = new Map<string, number>()
const byStatus = new Map<string, number>()
const samples: { url: string; error?: string; status?: number }[] = []

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  if (!r.resolvedAtClose) continue
  resolved++
  if (r.responseBodyHash) {
    ok++
    continue
  }
  fail++
  const key = r.error ?? `status ${r.status ?? '?'}`
  byErr.set(key, (byErr.get(key) ?? 0) + 1)
  byStatus.set(String(r.status ?? 'none'), (byStatus.get(String(r.status ?? 'none')) ?? 0) + 1)
  byHost.set(r.host, (byHost.get(r.host) ?? 0) + 1)
  if (samples.length < 8) samples.push({ url: r.url.slice(0, 120), error: r.error, status: r.status })
}

console.log('session', id)
console.log('resolvedAtClose', resolved, 'ok', ok, 'failed', fail)
console.log('top errors:', [...byErr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
console.log('top fail hosts:', [...byHost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
console.log('status:', [...byStatus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
console.log('samples:', samples)
