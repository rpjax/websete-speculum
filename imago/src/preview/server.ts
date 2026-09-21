import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { RunManifest } from '../generate/types.js'
import { sessionDir } from '../core/store.js'
import { indexSessionFixtures, lookupSessionFixture } from '../shared/sessionFixtures.js'
import { describeRequest, graphqlMissBody, relaxedGraphqlLookup } from '../shared/fixture.js'

export type PreviewMode = 'off' | 'fixtures' | 'proxy'

export interface PreviewTapeEntry {
  seq: number
  at: string
  kind: 'bundle' | 'fixture' | 'proxy' | 'blocked' | 'missing' | 'missing-asset' | 'local'
  method: string
  url: string
  status?: number
  note?: string
}

export interface PreviewHandle {
  runId: string
  sessionId: string
  url: string
  port: number
  mode: PreviewMode
  proxyBase: string | null
  tape: PreviewTapeEntry[]
  stop(): Promise<void>
  setMode(mode: PreviewMode, proxyBase?: string | null): void
}

/**
 * One preview, one origin (D-017).
 *
 * Root-mounted, because a bundle full of `/assets/…` cannot be served from a
 * subpath without rewriting it — and rewriting the artifact to look at it means no
 * longer looking at the artifact. Its own port, because the bundle carries
 * third-party JavaScript captured from a site we do not control and the panel can
 * read the filesystem.
 *
 * Read-only (D-020): it serves a run and never writes to it, nor to the session.
 */
export async function startPreview(opts: {
  runDir: string
  manifest: RunManifest
  mode: PreviewMode
  proxyBase?: string | null
  onTape: (entry: PreviewTapeEntry) => void
}): Promise<PreviewHandle> {
  const { runDir, manifest, onTape } = opts
  const fixtures = indexSessionFixtures(manifest.sessionId)
  const noiseHosts = noiseHostsOf(manifest.sessionId)
  const tape: PreviewTapeEntry[] = []
  let seq = 0
  let mode: PreviewMode = opts.mode
  let proxyBase: string | null = opts.proxyBase ?? null

  const record = (e: Omit<PreviewTapeEntry, 'seq' | 'at'>) => {
    const entry: PreviewTapeEntry = { ...e, seq: ++seq, at: new Date().toISOString() }
    tape.push(entry)
    if (tape.length > 3000) tape.splice(0, tape.length - 3000)
    onTape(entry)
  }

  const app: FastifyInstance = Fastify({ logger: false })
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_r, body, done) => done(null, body))

  // the bundle worker's own reporting channel
  app.post('/__imago/log', async (req) => {
    const body = safeJson(req.body)
    record({
      kind: (body?.kind as PreviewTapeEntry['kind']) ?? 'blocked',
      method: 'GET', url: String(body?.url ?? ''),
      note: body?.kind === 'blocked' ? 'not in bundle — closed world held (E2)' : undefined,
    })
    return { ok: true }
  })

  /**
   * Resolve one API call — from the bundle worker, or from the server itself when a
   * request falls through to a path no file answers (E-11).
   *
   * The bundle reaches us three ways and all three land here: the worker's
   * `/__imago/api`, a rewritten origin under `/__imago/h/<host>/…`, and a relative
   * call on our own origin. That redundancy is deliberate: a bundle whose worker
   * failed to take control must still get its data, or the page renders and dies.
   */
  const serveApi = async (
    target: string,
    method: string,
    body: Buffer | undefined,
    reply: import('fastify').FastifyReply,
  ) => {
    // E-17 — a beacon gets a benign answer, never a 404.
    //
    // Analytics and anti-fraud SDKs are not written to survive their endpoint
    // returning "not found": they throw, and the application's error boundary
    // catches it and replaces the page with "something went wrong". An empty 200
    // is what they see when they are simply not wanted, and they move on.
    const host = hostOf(target)
    if (host && noiseHosts.has(host)) {
      record({ kind: 'blocked', method, url: target, status: 200, note: 'telemetry stub' })
      return reply.status(200).type('application/json').send({})
    }

    if (mode === 'off') {
      record({ kind: 'blocked', method, url: target, status: 503, note: 'api mode: off' })
      return reply.status(503).type('application/json')
        .send({ imago: 'api mode is off — this is the app meeting a backend that is not there' })
    }

    if (mode === 'fixtures') {
      const shape = describeRequest(target, body, fixtures)
      const hit = lookupSessionFixture(fixtures, target, body, method)
      if (hit) {
        record({ kind: 'fixture', method, url: target, status: hit.status, note: hit.capturedAt })
        return reply.status(hit.status).type(hit.contentType).send(hit.body)
      }

      // the same operation with different variables — labelled, never silent
      const relaxed = relaxedGraphqlLookup(fixtures, target, shape)
      if (relaxed) {
        record({
          kind: 'fixture', method, url: target, status: relaxed.fixture.status,
          note: `${relaxed.fixture.capturedAt} · matched by ${relaxed.via}`,
        })
        return reply.status(relaxed.fixture.status).type(relaxed.fixture.contentType).send(relaxed.fixture.body)
      }

      const note = [
        'no fixture recorded',
        shape.operationName ? `operation ${shape.operationName}` : null,
        shape.persistedQuery ? `pq ${shape.persistedQuery.slice(0, 12)}` : null,
        `${shape.recordedForUrl} recorded for this url`,
      ].filter(Boolean).join(' · ')
      record({ kind: 'missing', method, url: target, status: shape.isGraphql ? 200 : 404, note })

      // A graphql client meeting a 404 with a foreign body throws, and React
      // unmounts the subtree — the page renders whole and then loses its navigation.
      if (shape.isGraphql) {
        return reply.status(200).type('application/json').send(graphqlMissBody(shape))
      }
      return reply.status(404).type('application/json').send({ imago: 'no fixture recorded' })
    }

    if (!proxyBase) {
      record({ kind: 'blocked', method, url: target, status: 503, note: 'proxy mode with no backend set' })
      return reply.status(503).send({ imago: 'proxy mode needs a backend URL' })
    }
    try {
      const parsed = new URL(target)
      const forwarded = new URL(parsed.pathname + parsed.search, proxyBase).toString()
      const res = await fetch(forwarded, {
        method,
        body: method === 'GET' || method === 'HEAD' ? undefined : (body ? new Uint8Array(body) : undefined),
      })
      const buf = Buffer.from(await res.arrayBuffer())
      const known = fixtures.has(target) || fixtures.has(stripQuery(target))
      record({
        kind: 'proxy', method, url: target, status: res.status,
        note: known ? undefined : 'not in the contract — the backend is answering a call nobody recorded',
      })
      return reply.status(res.status).type(res.headers.get('content-type') ?? 'application/octet-stream').send(buf)
    } catch (e) {
      record({ kind: 'blocked', method, url: target, status: 502, note: String(e).slice(0, 120) })
      return reply.status(502).send({ imago: 'backend unreachable', detail: String(e).slice(0, 200) })
    }
  }

  app.all('/__imago/api', async (req, reply) => {
    const target = String((req.query as Record<string, string>).u ?? '')
    const method = String(
      (req.headers['x-imago-method'] as string) ?? (req.query as Record<string, string>).m ?? 'GET',
    ).toUpperCase()
    const body = Buffer.isBuffer(req.body) ? (req.body as Buffer) : undefined
    return serveApi(target, method, body, reply)
  })

  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/__imago/')) return
    record({
      kind: reply.statusCode === 404 ? 'missing' : 'local',
      method: req.method, url: req.url, status: reply.statusCode,
    })
  })

  await app.register(fastifyStatic, { root: runDir })
  app.setNotFoundHandler(async (req, reply) => {
    // Client-side routing: an unknown path is a route, not a missing file — but only
    // for a navigation. Answering a data request with the entry document hands the
    // application HTML where it expected JSON, and it dies parsing it (E-8).
    const accept = String(req.headers['accept'] ?? '')
    const navigation = req.method === 'GET' &&
      (String(req.headers['sec-fetch-mode'] ?? '') === 'navigate' || accept.includes('text/html'))
    // Only a `rehost` bundle has a client-side router to hand the path to. A `flat`
    // bundle is N documents and nothing else, so answering an uncaptured path with
    // the entry document would show the operator the homepage under a URL that was
    // never captured — a lie that reads as success.
    if (navigation && manifest.emitter === 'rehost') return reply.sendFile(manifest.entry.slice(1))
    if (navigation) {
      // A dead end is still a fact the operator needs, but "no such document in this
      // bundle" on a black page reads as a crash. Say which URL was asked for, say
      // that `flat` has no router to hand it to, and list what this bundle *does*
      // hold — a session's atoms are the only pages there are, so this page is also
      // the bundle's index.
      record({ kind: 'missing', method: req.method, url: req.url, status: 404, note: 'not captured in this session' })
      return reply.status(404).type('text/html').send(notCaptured(req.url, manifest))
    }

    // E-11 — a data request no file answers is an API call, whichever way it was
    // addressed: a rewritten origin (`/__imago/h/<host>/…`) or a relative path on
    // our own origin. This is what keeps the bundle working when its worker is not
    // in control, which is the difference between a page that renders and a page
    // that renders and then blanks.
    const target = apiTargetFor(req.url, manifest.primaryHost)
    if (target) {
      // An asset the bundle does not hold is a capture gap, not an API call —
      // reported as such instead of hidden inside a fixture miss.
      if (req.method === 'GET' && /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm)(\?|$)/i.test(req.url)) {
        record({ kind: 'missing-asset', method: req.method, url: target, status: 404, note: 'not in bundle' })
        return reply.status(404).type('text/plain').send('asset not in bundle')
      }
      const body = Buffer.isBuffer(req.body) ? (req.body as Buffer) : undefined
      return serveApi(target, req.method.toUpperCase(), body, reply)
    }

    record({ kind: 'missing', method: req.method, url: req.url, status: 404, note: 'not in bundle' })
    return reply.status(404).type('application/json').send({ imago: 'not in bundle' })
  })

  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    runId: manifest.runId,
    sessionId: manifest.sessionId,
    url: `http://127.0.0.1:${port}/`,
    port,
    get mode() { return mode },
    get proxyBase() { return proxyBase },
    tape,
    setMode(next: PreviewMode, base?: string | null) {
      mode = next
      if (base !== undefined) proxyBase = base
      record({ kind: 'local', method: '—', url: `api mode → ${next}`, note: base ?? undefined })
    },
    stop: () => app.close(),
  } as PreviewHandle
}

/**
 * The URL a fallen-through request was really asking for.
 *
 * `/__imago/h/<host>/rest` → `https://<host>/rest` (a rewritten origin, E-10);
 * anything else on our origin → the primary host plus the path.
 */
export function apiTargetFor(requestUrl: string, primaryHost: string): string | null {
  const namespaced = /^\/__imago\/h\/([^/?#]+)(\/[^?#]*)?(\?.*)?$/.exec(requestUrl)
  if (namespaced) {
    const host = namespaced[1]!
    const path = namespaced[2] ?? '/'
    const query = namespaced[3] ?? ''
    return `https://${host}${path}${query}`
  }
  if (requestUrl.startsWith('/__imago/')) return null
  if (!primaryHost) return null
  return `https://${primaryHost}${requestUrl}`
}

function hostOf(url: string): string | null {
  try { return new URL(url).host } catch { return null }
}

/** Hosts this session classified as telemetry or challenge — stubbed, never 404'd. */
function noiseHostsOf(sessionId: string): Set<string> {
  const dir = join(sessionDir(sessionId), 'network')
  const out = new Set<string>()
  if (!existsSync(dir)) return out
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const rec = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { url: string; kind: string }
      if (rec.kind !== 'telemetry' && rec.kind !== 'challenge') continue
      const host = hostOf(rec.url)
      if (host) out.add(host)
    } catch { /* a record we cannot read tells us nothing */ }
  }
  return out
}

/** The bundle's own index, served where a page the session never captured was asked for. */
function notCaptured(requested: string, manifest: RunManifest): string {
  const docs = Object.entries(manifest.routes)
    .filter(([, local]) => /\.html?$/i.test(local))
    .sort((a, b) => a[0].localeCompare(b[0]))
  const rows = docs.map(([url, local]) =>
    `<li><a href="${esc(local)}">${esc(local)}</a> <span>${esc(url)}</span></li>`).join('')
  return `<!doctype html><meta charset="utf-8"><title>not captured — Imago</title><style>
    :root{color-scheme:dark}
    body{background:#14151a;color:#e6e6ea;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:48px}
    main{max-width:860px;margin:0 auto}
    h1{font-size:18px;margin:0 0 4px;font-weight:600}
    p{color:#9a9aa8;margin:0 0 24px}
    code{background:#1e1f27;padding:2px 6px;border-radius:4px;color:#e6e6ea}
    ul{list-style:none;padding:0;margin:0;border-top:1px solid #2a2b35}
    li{padding:10px 0;border-bottom:1px solid #2a2b35;display:flex;gap:16px;align-items:baseline}
    a{color:#7aa2ff}
    li span{color:#71717f;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  </style><main>
    <h1>This page was not captured in this session.</h1>
    <p>You asked for <code>${esc(requested)}</code>. A <b>flat</b> bundle is a set of documents and
    nothing else — it has no client-side router to hand that path to, so there is no page to show.
    To add it: record again, browse to it, press <b>Mark</b>, and generate.</p>
    <h1>Pages this bundle holds</h1>
    <ul>${rows || '<li>none</li>'}</ul>
  </main>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function stripQuery(url: string): string {
  const i = url.indexOf('?')
  return i < 0 ? url : url.slice(0, i)
}

function safeJson(body: unknown): Record<string, unknown> | null {
  try {
    if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8')) as Record<string, unknown>
    if (typeof body === 'string') return JSON.parse(body) as Record<string, unknown>
    return body as Record<string, unknown>
  } catch { return null }
}
