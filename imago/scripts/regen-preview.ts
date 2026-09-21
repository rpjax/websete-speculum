import { generateRehost } from '../src/generate/rehost.js'
import { runDir } from '../src/core/store.js'
import { startPreview } from '../src/preview/server.js'

const sid = process.argv[2] ?? 'sess-2026-09-03T07-32-44'
const manifest = generateRehost(sid)
const graphqlInRoutes = Object.keys(manifest.routes).filter((u) => u.includes('graphql')).length
console.log(JSON.stringify({ runId: manifest.runId, files: manifest.files, graphqlInRoutes }))

const handle = await startPreview({
  runDir: runDir(sid, manifest.runId),
  manifest,
  mode: 'fixtures',
  onTape: (e) => {
    if (e.kind === 'missing' || e.kind === 'missing-asset') {
      console.log('tape', e.kind, e.method, e.url?.slice(0, 120))
    }
    if (e.kind === 'missing' && e.url?.includes('graphql')) {
      console.log('graphql miss', e.note)
    }
  },
})
console.log('PREVIEW', handle.url)
