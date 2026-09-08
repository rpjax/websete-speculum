import { generateFlat } from './generate/flat.js'
const m = generateFlat('sess-2026-09-04T18-57-14')
console.log('files', m.files, 'missing', m.missing.length, 'runId', m.runId)
