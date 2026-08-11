/**
 * Prep Lab for ParityDebug hopdiag: stop live sessions, lab-reset, enable pack.
 * Usage: node prep-parity-hopdiag.cjs
 */
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE || 'http://127.0.0.1:8080'
const OUT = __dirname

function extractParityTypes() {
  const catalogPath = path.resolve(
    __dirname,
    '..',
    '..',
    'web',
    'src',
    'features',
    'admin',
    'configurations',
    'telemetrySessionEventsCatalog.ts',
  )
  const src = fs.readFileSync(catalogPath, 'utf8')
  // Collect all Telemetry.Sessions.* string literals in the catalog file —
  // ParityDebug pack is the Diff + Input path + ScrollEcho + Location + Virtual/Establish/Asset set.
  const all = [...src.matchAll(/'(Telemetry\.Sessions\.[^']+)'/g)].map((m) => m[1])
  const uniq = [...new Set(all)]
  const want = uniq.filter(
    (t) =>
      t.startsWith('Telemetry.Sessions.PageProjection.') ||
      t === 'Telemetry.Sessions.Browse.LocationChanged',
  )
  // Exclude VideoStreamingInput leftovers if any slipped in
  return want.filter((t) => !t.includes('VideoStreamingInput'))
}

async function json(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} → ${res.status}: ${text.slice(0, 400)}`)
  }
  return data
}

;(async () => {
  console.log('health', await json('GET', '/w7s/health/ready'))

  const sessions = await json('GET', '/w7s/api/sessions?take=50')
  const live = (sessions.items || []).filter((s) => String(s.state) === 'Live')
  console.log('live sessions', live.length)
  for (const s of live) {
    console.log('stop', s.sessionId)
    await json('POST', `/w7s/api/sessions/${s.sessionId}/stop`).catch((e) =>
      console.warn('stop failed', e.message),
    )
  }

  // Wait briefly for stops to settle
  await new Promise((r) => setTimeout(r, 1500))

  console.log('lab-reset…')
  const reset = await json('POST', '/w7s/api/admin/maintenance/lab-reset', { confirm: 'RESET' })
  console.log('lab-reset result', JSON.stringify(reset, null, 2))
  fs.writeFileSync(path.join(OUT, 'parityhop-lab-reset.json'), JSON.stringify(reset, null, 2))

  const types = extractParityTypes()
  console.log('ParityDebug types', types.length)

  const current = await json('GET', '/w7s/api/configurations/Telemetry')
  fs.writeFileSync(path.join(OUT, 'Telemetry.pre-parityhop.json'), JSON.stringify(current, null, 2))

  const events = {}
  for (const t of types) events[t] = true

  const body = {
    isEnabled: true,
    intervalSeconds: current.intervalSeconds ?? 60,
    clientObservation: {
      isEnabled: true,
      sessionWire: true,
      pageProjectionDiff: true,
      pageProjectionIntent: true,
      videoStreamingInput: false,
      // legacy aliases kept for older clients
      domProjectionDiff: true,
      domProjectionInput: true,
    },
    events,
  }

  const applied = await json('PUT', '/w7s/api/configurations/Telemetry', body)
  fs.writeFileSync(path.join(OUT, 'Telemetry.parityhop.json'), JSON.stringify(applied, null, 2))
  const on = Object.entries(applied.events || {}).filter(([, v]) => v).map(([k]) => k)
  console.log('Telemetry events ON', on.length)
  const missing = types.filter((t) => !on.includes(t))
  if (missing.length) {
    console.warn('WARN missing enabled types (catalog may reject unknown):', missing)
  }
  console.log('DONE prep')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
