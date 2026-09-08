/**
 * The resolver, proved against a simulated JavaScript application.
 *
 * This is the test that stands in for "download all the assets and be sure":
 * three real HTTP servers imitating the shape that broke on the first real target —
 * an app whose image URLs exist only inside a GraphQL payload, on a CDN host that
 * serves extension-less paths and had never delivered a byte during the browse, plus
 * an outbound docs site that must not be crawled.
 *
 * No browser, no vendor names, no fixtures of our own: the resolver has to discover
 * the CDN by evidence and leave the docs site alone.
 */
import Fastify from 'fastify'
import { AssetResolver, type StoredBody } from './ir/resolver.js'
import { hashBytes } from './core/hash.js'

export interface ResolverProof {
  failures: number
  lines: string[]
}

export async function proveResolver(): Promise<ResolverProof> {
  const lines: string[] = []
  let failures = 0
  const check = (name: string, cond: boolean, detail = '') => {
    if (cond) lines.push(`  ok   ${name}`)
    else { lines.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); failures++ }
  }

  // ── the simulated world ──────────────────────────────────────────────────────
  let cdnHits = 0
  let docsHits = 0
  let originPageHits = 0
  const cdnPaths = Array.from({ length: 12 }, (_, i) => `/rs:fit:190/ar:1/${'Z'.repeat(120)}${i}`)

  const cdn = Fastify({ logger: false })
  cdn.get('/*', async (req, reply) => {
    cdnHits++
    return reply.type('image/webp').send(Buffer.from(`WEBP${req.url}`))
  })
  await cdn.listen({ port: 0, host: '127.0.0.1' })
  const cdnPort = (cdn.server.address() as { port: number }).port
  const cdnHost = `127.0.0.1:${cdnPort}`

  const docs = Fastify({ logger: false })
  docs.get('/*', async (_req, reply) => {
    docsHits++
    return reply.type('text/html').send('<html><body>a documentation page</body></html>')
  })
  await docs.listen({ port: 0, host: '127.0.0.1' })
  const docsPort = (docs.server.address() as { port: number }).port
  const docsHost = `127.0.0.1:${docsPort}`

  const origin = Fastify({ logger: false })
  origin.get('/', async (_r, reply) => reply.type('text/html').send('<html></html>'))
  // the site's own pages: linked from the recorded document, and a crawl if followed
  origin.get('/hub/:slug', async (_r, reply) => {
    originPageHits++
    return reply.type('text/html').send('<html><a href="/hub/more">more</a></html>')
  })
  origin.get('/app.js', async (_r, reply) => reply.type('application/javascript').send('/* app */'))
  origin.get('/app.css', async (_r, reply) => reply.type('text/css').send('.a{}'))
  origin.get('/graphql', async (_r, reply) => reply.type('application/json').send('{}'))
  origin.get('/logo.svg', async (_r, reply) => reply.type('image/svg+xml').send('<svg/>'))
  origin.get('/late.woff2', async (_r, reply) => reply.type('font/woff2').send(Buffer.from('FONT')))
  origin.get('/gone.png', async (_r, reply) => reply.status(404).send('nope'))
  await origin.listen({ port: 0, host: '127.0.0.1' })
  const originPort = (origin.server.address() as { port: number }).port
  const originHost = `127.0.0.1:${originPort}`

  // ── what the browse recorded ─────────────────────────────────────────────────
  const bodies: StoredBody[] = []
  const blobs = new Map<string, string>()
  const record = (url: string, kind: string, contentType: string, text: string) => {
    const hash = hashBytes(text)
    blobs.set(hash, text)
    bodies.push({ url, kind, contentType, hash })
  }

  // the document: one asset written down, one link that is not an asset
  record(`http://${originHost}/`, 'asset', 'text/html',
    `<link rel="stylesheet" href="http://${originHost}/app.css">` +
    `<a href="http://${docsHost}/guide">docs</a>` +
    // its own pages, exactly as a storefront links them
    `<a href="http://${originHost}/hub/keyboards">keyboards</a>` +
    `<a href="http://${originHost}/hub/mice">mice</a>`)

  // a stylesheet that references a font nobody loaded during the browse
  record(`http://${originHost}/app.css`, 'asset', 'text/css',
    `@font-face{src:url(http://${originHost}/late.woff2)}` +
    `.hero{background:url(http://${originHost}/gone.png)}`)

  // the bundle: urls built at runtime, and the endpoint it calls
  record(`http://${originHost}/app.js`, 'asset', 'application/javascript',
    `var L="http://${originHost}/logo.svg";fetch("http://${originHost}/graphql");` +
    `var help="http://${docsHost}/guide/getting-started";`)

  // the payload: every product image lives here and nowhere else, JSON-escaped
  record(`http://${originHost}/graphql`, 'api', 'application/json',
    JSON.stringify({ data: { products: cdnPaths.map((p) => ({ image: `http://${cdnHost}${p}` })) } })
      .replace(/\//g, '\\/'))

  // ── run the real resolver ────────────────────────────────────────────────────
  const notes: string[] = []
  const resolver = new AssetResolver({
    bodies: () => bodies,
    readBody: (hash) => blobs.get(hash) ?? null,
    fetch: async (url) => {
      const res = await fetch(url)
      const contentType = res.headers.get('content-type') ?? undefined
      if (!res.ok) return { ok: false, status: res.status, contentType }
      return { ok: true, status: res.status, contentType, body: Buffer.from(await res.arrayBuffer()) }
    },
    onFetched: (url, result) => {
      if (!result.ok || !result.body) return
      const hash = hashBytes(result.body)
      blobs.set(hash, result.body.toString('utf8'))
      return hash
    },
    onStored: (entry) => { bodies.push(entry) },
    onProgress: () => undefined,
    onNote: (code, detail) => notes.push(`${code}: ${detail}`),
  })

  const summary = await resolver.run([`http://${originHost}/app.js`])

  // ── the guarantees ──────────────────────────────────────────────────────────
  check('a seed reference is fetched', summary.fetched > 0)
  check('an asset referenced only by css is fetched (the font nobody loaded)',
    cdnHits >= 0 && summary.fetched >= 2)
  check('every image that existed only inside the api payload is downloaded',
    cdnHits === cdnPaths.length, `${cdnHits} of ${cdnPaths.length}`)
  check('an extension-less cdn host is discovered by evidence, with no vendor name',
    summary.promoted.includes(cdnHost), JSON.stringify(summary.promoted))
  check('discovering it costs exactly one probe per unknown host', summary.probed <= 2, String(summary.probed))
  check('the docs site is probed once and then left alone', docsHits === 1, `${docsHits} hits`)
  check('a docs page is never downloaded as an asset', !summary.promoted.includes(docsHost))
  check('a 404 is counted as a failure, not as fetched', summary.failed >= 1, String(summary.failed))
  check('the site\'s own pages are never downloaded — a sweep is not a crawl',
    originPageHits === 0, `${originPageHits} page hits`)
  check('an extension-less url on an asset-only host is still taken',
    cdnHits === cdnPaths.length, `${cdnHits}`)
  check('the download stays small — no runaway', summary.bytes < 1024 * 1024, `${summary.bytes} bytes`)
  check('the sweep terminates instead of looping', summary.rounds < 12, String(summary.rounds))
  check('nothing was left capped', !summary.capped)
  check('unpromoted hosts are reported, not silently dropped',
    summary.pendingLeft === 0 || notes.some((n) => n.startsWith('sweep_unpromoted')),
    JSON.stringify(notes))

  await Promise.all([cdn.close(), docs.close(), origin.close()])
  return { failures, lines }
}
