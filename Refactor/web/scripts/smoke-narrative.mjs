import fs from 'node:fs'
import { journalToNarrativeEvent } from '../src/lib/timelineApi.ts'

const path = process.argv[2]
const data = JSON.parse(fs.readFileSync(path, 'utf8'))
const events = data.items.map(journalToNarrativeEvent)
for (const e of events) {
  const t = Date.parse(e.utc)
  if (!Number.isFinite(t)) console.log('BAD DATE', e.utc)
}
console.log(JSON.stringify({
  count: events.length,
  domains: [...new Set(events.map((e) => e.domain))],
  sample: events[0],
}, null, 2))
