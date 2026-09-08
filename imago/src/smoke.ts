/**
 * F1 smoke — effect asserts on the parts that do not need a browser: canonical
 * hashing (O5a depends on it), the journal's content addressing, and the closure
 * check (C-4). A green run here does not prove capture works; it proves these do.
 */
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson, hashJson, hashBytes } from './core/hash.js'
import { Journal } from './core/journal.js'
import { finalize, readClosure } from './ir/close.js'
import { decideSettle } from './recorder/settle.js'
import { analyzeO4, analyzeO4b } from './parity/o4.js'
import { readParityReport } from './parity/run.js'
import { recoverOrphans } from './panel/state.js'
import { startPanel } from './panel/server.js'
import { isFetchable, subresourceAttrs } from './shared/refPolicy.js'
import { isFixtureResponse, fixtureKey } from './shared/fixture.js'
import { assetHostsOf, expandAssetHosts, extractUrls, isTextual, looksLikeAsset, sweepable } from './shared/sweep.js'
import { localPath, originRewrites } from './generate/rehost.js'
import { proveFlatHtml } from './smoke.flat.js'
import { proveResolver } from './smoke.resolver.js'
import {
  SESSION_SCHEMA, ensureDirs, listIncompatible, listSessions, readMeta, sessionDir, sessionsDir, writeMeta,
} from './core/store.js'
import type { NetworkRecord, SessionMeta, SnapshotRecord } from './core/types.js'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok   ${name}`)
  else { console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); failures++ }
}

// ── canonical hashing ──────────────────────────────────────────────────────────
const a = { b: 1, a: [{ y: 2, x: 1 }] }
const b = { a: [{ x: 1, y: 2 }], b: 1 }
check('key order does not change the hash', hashJson(a) === hashJson(b))
check('canonical json sorts keys', canonicalJson(a) === '{"a":[{"x":1,"y":2}],"b":1}', canonicalJson(a))
check('different content, different hash', hashJson(a) !== hashJson({ b: 2 }))
check('hash is 16 hex', /^[0-9a-f]{16}$/.test(hashBytes('x')))

// ── journal / content addressing ───────────────────────────────────────────────
const jdir = mkdtempSync(join(tmpdir(), 'imago-smoke-'))
const journal = new Journal(jdir)
const h1 = journal.putBlob('hello')
const h2 = journal.putBlob(Buffer.from('hello'))
check('same bytes → same blob hash (IR-1)', h1 === h2)
check('blob is on disk', journal.hasBlob(h1))
check('blob round-trips', journal.readBlob(h1).toString() === 'hello')
journal.writeRaw('raw.txt', '{"a":1}')
check('writeRaw writes exact bytes', readFileSync(join(jdir, 'raw.txt'), 'utf8') === '{"a":1}')

// ── closure check (C-4) ────────────────────────────────────────────────────────
process.env.IMAGO_HOME = mkdtempSync(join(tmpdir(), 'imago-home-'))
const id = 'sess-smoke'
const dir = ensureDirs(id)
const meta: SessionMeta = {
  schema: SESSION_SCHEMA,
  id, name: 'smoke', status: 'closed', origins: ['example.com'],
  openedAt: new Date().toISOString(), config: {},
  versions: { imago: '0.0.0', node: process.version },
  stats: { snapshots: 0, requests: 0, bytes: 0, atoms: 0, errors: 0 },
}
writeMeta(meta)

const bodyHash = hashBytes('body{}')
mkdirSync(join(dir, 'blobs'), { recursive: true })
writeFileSync(join(dir, 'blobs', bodyHash), 'body{}')
const net: NetworkRecord = {
  reqId: 'req-0', at: meta.openedAt, method: 'GET', url: 'https://example.com/app.css',
  host: 'example.com', resourceType: 'stylesheet', status: 200, requestHeaders: {},
  responseHeaders: { 'content-type': 'text/css' }, responseBodyHash: bodyHash, bytes: 6, kind: 'asset',
}
writeFileSync(join(dir, 'network', 'req-0.json'), JSON.stringify(net))
const snap: SnapshotRecord = {
  id: 'snap-0000', trigger: 'settle', at: meta.openedAt, url: 'https://example.com/',
  title: 't', viewport: { width: 1280, height: 800, dpr: 1 }, tree: 'deadbeefdeadbeef',
  styles: [], refs: ['https://example.com/app.css', 'https://example.com/never-fetched.png'],
}
writeFileSync(join(dir, 'snapshots', 'snap-0000.json'), JSON.stringify(snap))

const report = finalize(id)
check('promoted the response body into assets/', existsSync(join(sessionDir(id), 'assets', `${bodyHash}.css`)))
check('closure reports the unfetched reference', report.unresolved.length === 1, JSON.stringify(report.unresolved))
check('closure does not flag a fetched reference',
  report.unresolved[0]?.url === 'https://example.com/never-fetched.png', JSON.stringify(report.unresolved[0]))
check('closure groups what is missing by host',
  report.unresolvedByHost[0]?.host === 'example.com' && report.unresolvedByHost[0]?.count === 1)
check('closure.json is written', existsSync(join(sessionDir(id), 'closure.json')))

// ── settle decision (A-11 / A-12) ──────────────────────────────────────────────
const base = {
  readyState: 'complete', quietMs: 900, settleMs: 500, fontsPending: false,
  freshInflight: 0, longLived: 0, msSinceLastSnapshot: 0, intervalMs: 20_000,
}
check('settles when quiet', decideSettle(base).take)
check('does not settle while loading', !decideSettle({ ...base, readyState: 'loading' }).take)
check('fresh in-flight blocks settle', !decideSettle({ ...base, freshInflight: 2 }).take)
check('long-lived in-flight does NOT block settle (A-11)', decideSettle({ ...base, longLived: 10 }).take)
check('pending fonts block settle', !decideSettle({ ...base, fontsPending: true }).take)
check('recent mutation blocks settle', !decideSettle({ ...base, quietMs: 100 }).take)
const forever = decideSettle({ ...base, quietMs: 50, msSinceLastSnapshot: 30_000 })
check('a page that never settles still gets an interval snapshot (A-12)',
  forever.take && forever.trigger === 'interval')
check('interval never fires while the document is loading',
  !decideSettle({ ...base, readyState: 'loading', msSinceLastSnapshot: 30_000 }).take)

// ── orphan recovery (S-9) ──────────────────────────────────────────────────────
const orphanId = 'sess-orphan'
ensureDirs(orphanId)
writeMeta({ ...meta, id: orphanId, status: 'recording' })
const recovered = recoverOrphans()
check('an interrupted session is recovered, not left claiming to be live',
  recovered.includes(orphanId) && readMeta(orphanId)?.status === 'failed')
check('a recovered session gets a closure report', existsSync(join(sessionDir(orphanId), 'closure.json')))
check('recovery is idempotent', recoverOrphans().length === 0)

// ── what counts as a subresource (refPolicy) ───────────────────────────────────
check('an <a href> is a destination, not an asset', subresourceAttrs('a').length === 0)
check('an <area href> is not an asset', subresourceAttrs('area').length === 0)
check('a <base href> is not an asset', subresourceAttrs('base').length === 0)
check('link rel=stylesheet is an asset', subresourceAttrs('link', 'stylesheet').length === 1)
check('link rel=preload is an asset', subresourceAttrs('link', 'preload').length === 1)
check('link rel=canonical is NOT an asset', subresourceAttrs('link', 'canonical').length === 0)
check('link rel=preconnect is NOT an asset', subresourceAttrs('link', 'dns-prefetch').length === 0)
check('img carries src and srcset',
  subresourceAttrs('img').filter((r) => r.attr === 'src' || r.attr === 'srcset').length === 2)
check('srcset is marked as a candidate list',
  subresourceAttrs('img').find((r) => r.attr === 'srcset')?.kind === 'srcset')
check('mailto is not fetchable', !isFetchable('mailto:a@b.c'))
check('a bare fragment is not fetchable', !isFetchable('#top'))
check('a data uri is not fetchable', !isFetchable('data:image/png;base64,AAAA'))
check('an https url is fetchable', isFetchable('https://example.com/a.png'))
check('an ipv4 authority is extracted — a locally served asset is still an asset',
  extractUrls('src="http://127.0.0.1:8080/logo.svg"').includes('http://127.0.0.1:8080/logo.svg'))
check('localhost is extracted', extractUrls('"http://localhost:3000/a.png"').includes('http://localhost:3000/a.png'))
check('a line comment in a minified bundle is not a url',
  extractUrls('var a=1;//TODO:fix later\nvar b=2').length === 0,
  JSON.stringify(extractUrls('var a=1;//TODO:fix later')))

// ── the reader is strict, not compatible (D-031) ───────────────────────────────
const current = {
  schema: 1, sessionId: 's', snapshots: 1, requests: 1, assets: 1, styles: 1, trees: 1,
  resolved: 0, unresolved: [], unresolvedByHost: [], errors: 0, status: 'closed',
}
check('a report from this build reads', readClosure(current) !== null)
check('a report from an older build is refused, not translated',
  readClosure({ ...current, schema: undefined }) === null)
check('a different schema version is refused', readClosure({ ...current, schema: 99 }) === null)
check('a missing property fails — never skip-if-absent',
  readClosure({ ...current, trees: undefined }) === null)
check('the old string[] shape is refused',
  readClosure({ ...current, unresolved: ['https://a.test/x.png'] }) === null)
check('garbage is refused', readClosure('nope') === null)

// ── incompatible data: listed apart, never adapted, never auto-removed (S-12) ──
const oldId = 'sess-from-an-old-build'
mkdirSync(join(sessionsDir(), oldId), { recursive: true })
writeFileSync(join(sessionsDir(), oldId, 'session.json'), JSON.stringify({
  id: oldId, name: 'old', status: 'closed', origins: [],
  openedAt: new Date().toISOString(), stats: {},
}))
check('a session from another build is reported as incompatible',
  listIncompatible().some((x) => x.id === oldId), JSON.stringify(listIncompatible()))
check('it is kept out of the readable session list',
  !listSessions().some((x) => x.id === oldId))
check('nothing deleted it — deletion is the operator\'s',
  existsSync(join(sessionsDir(), oldId)))
check('a current session is not reported as incompatible',
  !listIncompatible().some((x) => x.id === id))

// ── sweeping for assets the DOM never mentions (C-4c) ─────────────────────────
const jsSource = `var CDN="https://img.test/a/b.png";fetch("https://api.test/v1/items");` +
  `var x='//img.test/c.png';var doc="see https://docs.other.test/guide";`
const found = extractUrls(jsSource)
check('a url built in javascript is found', found.includes('https://img.test/a/b.png'))
check('a protocol-relative url is normalised', found.includes('https://img.test/c.png'))
check('an api endpoint mentioned in source is found too', found.includes('https://api.test/v1/items'))
const jsonPayload = '{"image":"https:\\/\\/img.test\\/from-api.png","n":1}'
check('an escaped url inside a json payload is unescaped',
  extractUrls(jsonPayload).includes('https://img.test/from-api.png'), JSON.stringify(extractUrls(jsonPayload)))

const hosts = assetHostsOf([
  { url: 'https://img.test/x.png', kind: 'asset', contentType: 'image/png' },
  { url: 'https://analytics.test/beacon', kind: 'telemetry', contentType: 'text/plain' },
])
check('a host that served an asset is sweepable', hosts.has('img.test'))
check('a telemetry-only host is never swept', !hosts.has('analytics.test'))
check('a url on an asset host is fetched',
  sweepable('https://img.test/a/b.png', hosts, new Set()))
check('a url the page merely mentions is not crawled',
  !sweepable('https://docs.other.test/guide', hosts, new Set()))
check('an already fetched url is not fetched twice',
  !sweepable('https://img.test/a/b.png', hosts, new Set(['https://img.test/a/b.png'])))
check('a json body is swept', isTextual('application/json; charset=utf-8'))
check('an image body is not swept', !isTextual('image/png'))
check('a bare host is not extracted', !extractUrls('CDN="https://img.test"').includes('https://img.test'))
check('an imgproxy url is asset-shaped', looksLikeAsset('https://img.test/x/y/rs:fit:190/z.webp'))
check('a docs link is not asset-shaped', !looksLikeAsset('https://docs.other.test/guide'))
const payloadHosts = new Set<string>()
expandAssetHosts(payloadHosts, ['https://imgproxy.test/a/b.png'])
check('an asset url in a payload promotes its host', payloadHosts.has('imgproxy.test'))
const fenced = new Set<string>()
expandAssetHosts(fenced, ['https://docs.other.test/guide/readme'])
check('a docs link does not promote its host', !fenced.has('docs.other.test'))
check('a payload-only host is swept once named',
  sweepable('https://imgproxy.test/z.png', payloadHosts, new Set()))
check('a hub page link is not asset-shaped',
  !looksLikeAsset('https://www.eneba.com/hub/keyboards/'))
check('a failed resolve is not retried',
  !sweepable('https://img.test/x.png', payloadHosts, new Set(), new Set(['https://img.test/x.png'])))

// ── API fixtures vs static bundle files ───────────────────────────────────────
check('a cross-origin graphql POST is a fixture, not a static file',
  isFixtureResponse({
    method: 'POST', kind: 'thirdparty', resourceType: 'fetch',
    responseHeaders: { 'content-type': 'application/json' },
  }))
check('a png is not a fixture', !isFixtureResponse({
  method: 'GET', kind: 'asset', resourceType: 'image',
  responseHeaders: { 'content-type': 'image/png' },
}))
check('fixture keys disambiguate POST bodies',
  fixtureKey('https://g.test/', 'abc') === 'https://g.test/#abc')

// ── panel HTTP contract ────────────────────────────────────────────────────────
// An action endpoint takes no payload. Getting this wrong made "Close sandbox"
// answer `Bad Request` from the body parser, leaving a session impossible to close.
const { url, close: stopPanel } = await startPanel(0)

const post = async (path: string, body?: unknown) => {
  const res = await fetch(url.replace(/\/$/, '') + path, body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

const state = await fetch(url + 'api/state').then((r) => r.json()) as any
check('GET /api/state answers with a panel state', state && state.recording === false && Array.isArray(state.sessions))

const mark = await post('/api/record/mark')
check('POST mark with no body is not a parser error',
  mark.body?.error !== 'Bad Request', JSON.stringify(mark))
check('POST mark with no recording says so in words',
  typeof mark.body?.error === 'string' && /not recording/i.test(mark.body.error), JSON.stringify(mark))

const closed = await post('/api/record/close')
check('POST close with no body is not a parser error',
  closed.body?.error !== 'Bad Request', JSON.stringify(closed))
check('POST close with no recording says so in words',
  typeof closed.body?.error === 'string' && /not recording/i.test(closed.body.error), JSON.stringify(closed))

const badJson = await fetch(url + 'api/record/start', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json',
})
check('malformed JSON is still rejected', badJson.status >= 400)

// ── generate + preview (D-005 / D-016…D-020) ──────────────────────────────────
// A whole session built by hand, then generated and served, so the emitter and the
// preview are exercised without a browser anywhere in sight.
const gid = 'sess-gen'
const gdir = ensureDirs(gid)
writeMeta({ ...meta, id: gid, name: 'generated', status: 'closed', origins: ['shop.test'] })

const put = (text: string | Buffer) => {
  const h = hashBytes(text)
  writeFileSync(join(gdir, 'blobs', h), text)
  return h
}
const html = `<!doctype html><html><head><link rel="stylesheet" href="https://shop.test/a.css">` +
  `<link rel="canonical" href="https://shop.test/x"></head>` +
  `<body><img src="https://cdn.test/logo.png"><a href="https://elsewhere.test/go">out</a></body></html>`
const css = `body{background:url(https://cdn.test/bg.png)}a:hover{color:red}`
const recorded = [
  { reqId: 'n0', url: 'https://shop.test/', ct: 'text/html', body: html, kind: 'asset' },
  // a real entry url: no trailing slash, no extension, serves html
  { reqId: 'n0b', url: 'https://shop.test/steam-gift-terraria', ct: 'text/html; charset=utf-8',
    body: html, kind: 'asset' },
  // an extension-less javascript asset — served as octet-stream it would download
  { reqId: 'n0c', url: 'https://shop.test/edge/script', ct: 'application/javascript',
    body: 'var a=1;', kind: 'asset' },
  { reqId: 'n1', url: 'https://shop.test/a.css', ct: 'text/css', body: css, kind: 'asset' },
  { reqId: 'n1b', url: 'https://shop.test/app.js', ct: 'application/javascript',
    body: 'var API="https://graphql.shop.test/graphql/";fetch(API,{method:"POST"});', kind: 'asset' },
  { reqId: 'n2', url: 'https://cdn.test/logo.png', ct: 'image/png', body: 'PNG', kind: 'asset' },
  { reqId: 'n3', url: 'https://cdn.test/bg.png', ct: 'image/png', body: 'BG', kind: 'asset' },
  { reqId: 'n4', url: 'https://shop.test/api/items', ct: 'application/json', body: '{"items":[1,2]}', kind: 'api' },
  // what an image proxy actually looks like: no extension, and 140+ chars that
  // differ only near the end
  // a path that is a file for one url and a directory for another — the collision
  // that made a real generation die on EEXIST
  { reqId: 'n9', url: 'https://shop.test/pixel.js', ct: 'application/javascript',
    body: 'PIXEL-FILE', kind: 'thirdparty' },
  { reqId: 'n10', url: 'https://shop.test/pixel.js/track.js', ct: 'application/javascript',
    body: 'PIXEL-TRACK', kind: 'thirdparty' },
  { reqId: 'n5', url: 'https://imgproxy.test/rs:fit:190/ar:1/' + 'Q'.repeat(140) + '/one',
    ct: 'image/webp', body: 'WEBP-ONE', kind: 'asset' },
  { reqId: 'n6', url: 'https://imgproxy.test/rs:fit:190/ar:1/' + 'Q'.repeat(140) + '/two',
    ct: 'image/webp', body: 'WEBP-TWO', kind: 'asset' },
]
for (const r of recorded) {
  writeFileSync(join(gdir, 'network', `${r.reqId}.json`), JSON.stringify({
    reqId: r.reqId, at: meta.openedAt, method: 'GET', url: r.url, host: new URL(r.url).host,
    resourceType: 'other', status: 200, requestHeaders: {}, responseHeaders: { 'content-type': r.ct },
    responseBodyHash: put(r.body), bytes: r.body.length, kind: r.kind,
  }))
}

// a POST graphql call, as a client-routed app actually makes it: same origin,
// relative path, body carrying the query
const gqlRequest = JSON.stringify({ operationName: 'Products', variables: { page: 1 } })
const gqlResponse = '{"data":{"products":[{"id":1}]}}'
writeFileSync(join(gdir, 'network', 'n8.json'), JSON.stringify({
  reqId: 'n8', at: meta.openedAt, method: 'POST', url: 'https://graphql.shop.test/graphql/',
  host: 'graphql.shop.test',
  resourceType: 'fetch', status: 200,
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  requestBodyHash: put(JSON.stringify({ operationName: 'Hero', variables: { currency: 'BRL' } })),
  responseBodyHash: put('{"data":{"hero":{"title":"Double Feature"}}}'),
  bytes: 44, kind: 'api',
}))
writeFileSync(join(gdir, 'network', 'n7.json'), JSON.stringify({
  reqId: 'n7', at: meta.openedAt, method: 'POST', url: 'https://shop.test/graphql', host: 'shop.test',
  resourceType: 'fetch', status: 200,
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  requestBodyHash: put(gqlRequest), responseBodyHash: put(gqlResponse),
  bytes: gqlResponse.length, kind: 'api',
}))
// A beacon: recorded because it happened, never stored, never emitted. It exists
// so the preview knows which hosts are noise (E-17).
writeFileSync(join(gdir, 'network', 'n11.json'), JSON.stringify({
  reqId: 'n11', at: meta.openedAt, method: 'POST', url: 'https://beacon.telemetry.test/collect',
  host: 'beacon.telemetry.test', resourceType: 'fetch', status: 204,
  requestHeaders: {}, responseHeaders: {}, bytes: 0, kind: 'telemetry',
}))
// A real tree and a real cascade. The old fixture carried `tree: 'x'` and no
// styles, which was enough for `rehost` (it re-serves recorded bytes and never
// looks at the tree) and is exactly nothing for `flat` — the emitter whose input
// *is* the tree. A fixture shaped around one emitter proves nothing about the other.
const el = (n: string, a: Record<string, string> = {}, c: unknown[] = []) =>
  ({ t: 'element', n, a, c })
const txt = (v: string) => ({ t: 'text', v })

const treeMain = el('html', { lang: 'pt-BR' }, [
  el('head', {}, [
    el('title', {}, [txt('shop')]),
    el('link', { rel: 'stylesheet', href: 'https://shop.test/a.css' }),
    el('link', { rel: 'canonical', href: 'https://shop.test/x' }),
    el('script', { src: 'https://shop.test/app.js' }),
  ]),
  el('body', {}, [
    el('img', { src: 'https://cdn.test/logo.png', alt: 'logo' }),
    el('a', { href: 'https://elsewhere.test/go' }, [txt('out')]),
    el('a', { href: 'https://shop.test/' }, [txt('home')]),
    el('button', { onclick: 'buy()' }, [txt('buy')]),
  ]),
])
const treeHome = el('html', {}, [
  el('head', {}, [el('title', {}, [txt('home')])]),
  el('body', {}, [el('img', { src: 'https://cdn.test/logo.png', alt: 'logo' })]),
])

const cssHash = put(css)
for (const [name, tree] of [['treeMain', treeMain], ['treeHome', treeHome]] as const) {
  void name
  writeFileSync(join(gdir, 'trees', `${hashJson(tree)}.json`), canonicalJson(tree))
}
writeFileSync(join(gdir, 'snapshots', 'snap-0000.json'), JSON.stringify({
  id: 'snap-0000', trigger: 'mark', at: meta.openedAt,
  url: 'https://shop.test/steam-gift-terraria', title: 'shop',
  viewport: { width: 1280, height: 800, dpr: 1 },
  tree: hashJson(treeMain), styles: [cssHash],
  refs: ['https://shop.test/a.css', 'https://cdn.test/logo.png', 'https://cdn.test/bg.png'],
}))
// a second atom, so the operator's marks become each other's links
writeFileSync(join(gdir, 'snapshots', 'snap-0001.json'), JSON.stringify({
  id: 'snap-0001', trigger: 'mark', at: meta.openedAt,
  url: 'https://shop.test/', title: 'home',
  viewport: { width: 1280, height: 800, dpr: 1 },
  tree: hashJson(treeHome), styles: [cssHash],
  refs: ['https://cdn.test/logo.png'],
}))

const REHOST_PROFILE = { emitter: 'rehost', apiBase: null, hosts: {}, defaultDisposition: 'stub' }
const gen = await post('/api/generate', { sessionId: gid, profile: REHOST_PROFILE })
check('generate answers with a run manifest', gen.body?.manifest?.runId !== undefined, JSON.stringify(gen.body))
const manifest = gen.body.manifest
// the chain that matters: swept asset → generated file → route map → served byte
const cdnOne = 'https://imgproxy.test/rs:fit:190/ar:1/' + 'Q'.repeat(140) + '/one'
const cdnTwo = 'https://imgproxy.test/rs:fit:190/ar:1/' + 'Q'.repeat(140) + '/two'
check('an extension-less cdn asset is in the route map under its exact url',
  typeof manifest.routes[cdnOne] === 'string', JSON.stringify(Object.keys(manifest.routes).slice(-2)))
check('two near-identical cdn urls map to different files',
  manifest.routes[cdnOne] !== manifest.routes[cdnTwo])
// a file/directory collision must not kill the generation
const pixelFile = manifest.routes['https://shop.test/pixel.js']
const pixelDir = manifest.routes['https://shop.test/pixel.js/track.js']
check('a path that is a file for one url and a folder for another still generates',
  typeof pixelFile === 'string' && typeof pixelDir === 'string',
  `${pixelFile} / ${pixelDir}`)
check('the collision loser is stored content-addressed',
  pixelFile.startsWith('/__imago/a/') || pixelDir.startsWith('/__imago/a/'),
  `${pixelFile} / ${pixelDir}`)
check('the substitution is recorded as a warning',
  manifest.warnings.some((w: string) => w.includes('path collision')),
  JSON.stringify(manifest.warnings))

// E-15 — extension-less urls must not be served as octet-stream, or the browser
// downloads the page instead of rendering it
check('an html document at an extension-less url becomes index.html',
  manifest.routes['https://shop.test/steam-gift-terraria'] === '/steam-gift-terraria/index.html',
  manifest.routes['https://shop.test/steam-gift-terraria'])
check('an extension-less javascript asset gains .js',
  manifest.routes['https://shop.test/edge/script'] === '/edge/script.js',
  manifest.routes['https://shop.test/edge/script'])

check('the cdn asset is content-addressed, not a 200-char path',
  manifest.routes[cdnOne].startsWith('/__imago/a/') && manifest.routes[cdnOne].length < 60,
  manifest.routes[cdnOne])
check('the primary host becomes the web root', manifest.primaryHost === 'shop.test')
check('the entry is the recorded document', /index\.html$/.test(manifest.entry), manifest.entry)
check('cross-origin assets are namespaced, not dropped',
  manifest.routes['https://cdn.test/logo.png'] === '/__imago/h/cdn.test/logo.png',
  manifest.routes['https://cdn.test/logo.png'])
check('api fixtures are not written as static files', manifest.files === recorded.length - 1, String(manifest.files))
check('api fixtures are not in the route map', manifest.routes['https://shop.test/api/items'] === undefined)
check('nothing is missing — the session was closed', manifest.missing.length === 0, JSON.stringify(manifest.missing))

// long, near-identical urls must never collide onto one file
const longA = 'https://imgproxy.test/' + 'A'.repeat(140) + '/rs:fit:190/ar:1/czM6Ly9wcm9k'
const longB = 'https://imgproxy.test/' + 'A'.repeat(140) + '/rs:fit:300/ar:1/czM6Ly9wcm9k'
const pa = localPath(longA, 'shop.test')
const pb = localPath(longB, 'shop.test')
check('a long url is stored content-addressed', pa?.startsWith('__imago/a/') === true, String(pa))
check('two long urls that differ near the end get different files', pa !== pb, `${pa} vs ${pb}`)
check('the local path stays inside the windows budget', (pa?.length ?? 999) < 120, String(pa?.length))
check('a short url keeps its readable path',
  localPath('https://shop.test/assets/app.css', 'shop.test') === 'assets/app.css',
  String(localPath('https://shop.test/assets/app.css', 'shop.test')))
check('an extension survives content-addressing',
  localPath('https://imgproxy.test/' + 'B'.repeat(140) + '/x.webp', 'shop.test')?.endsWith('.webp') === true)

const started = await post('/api/preview/start', { sessionId: gid, runId: manifest.runId, mode: 'off' })
check('preview starts on its own origin', /^http:\/\/127\.0\.0\.1:\d+\/$/.test(started.body?.preview?.url ?? ''),
  JSON.stringify(started.body))
const pUrl = started.body.preview.url.replace(/\/$/, '')
check('the preview does not share the panel port', started.body.preview.url !== url)

const rootRes = await fetch(pUrl + '/')
check('the preview serves the entry as html, never as a download',
  (rootRes.headers.get('content-type') ?? '').includes('text/html'),
  String(rootRes.headers.get('content-type')))
const index = await rootRes.text()
check('the entry document is served at the root', index.includes('<!doctype html>'))
check('the bundle worker is injected', index.includes('imago-sw.js'))
check('an absolute asset url was rewritten to a local path', index.includes('/__imago/h/cdn.test/logo.png'))
check('the stylesheet link was rewritten', index.includes('href="/a.css"'), index.slice(0, 200))
check('an outbound <a href> is left alone — it is a destination, not an asset',
  index.includes('https://elsewhere.test/go'))

const servedCss = await fetch(pUrl + '/a.css').then((r) => r.text())
check('css url() was rewritten', servedCss.includes('url(/__imago/h/cdn.test/bg.png)'), servedCss)
check('a :hover rule survived into the bundle', servedCss.includes('a:hover'))

const oneServed = await fetch(pUrl + manifest.routes[cdnOne]).then((r) => r.text())
const twoServed = await fetch(pUrl + manifest.routes[cdnTwo]).then((r) => r.text())
check('the preview serves the cdn asset the page will ask for', oneServed === 'WEBP-ONE', oneServed)
check('and serves the right one of the two', twoServed === 'WEBP-TWO', twoServed)

// E-10 — the api origin the bundle builds at runtime must point at us, not at the
// real internet, or the browser refuses it on CORS and the app never gets data
const appJs = await fetch(pUrl + manifest.routes['https://shop.test/app.js']).then((r) => r.text())
check('an api origin inside javascript is pointed at the preview',
  appJs.includes('/__imago/h/graphql.shop.test/graphql/') && !appJs.includes('https://graphql.shop.test'),
  appJs)
check('the rewritten origins are listed in the manifest',
  (manifest.rewrittenOrigins ?? []).includes('https://graphql.shop.test'),
  JSON.stringify(manifest.rewrittenOrigins))

const jsRes = await fetch(pUrl + '/edge/script.js')
check('an extension-less javascript asset is served as javascript',
  (jsRes.headers.get('content-type') ?? '').includes('javascript'),
  String(jsRes.headers.get('content-type')))

const routesJson = await fetch(pUrl + '/imago-routes.json').then((r) => r.json()) as any
check('the worker route map holds static assets only', Object.keys(routesJson.routes).length === recorded.length - 1)

const apiOff = await fetch(`${pUrl}/__imago/api?u=${encodeURIComponent('https://shop.test/api/items')}`)
check('api mode off lets the call fail, as the app would', apiOff.status === 503)

await post('/api/preview/mode', { runId: manifest.runId, mode: 'fixtures' })
const apiFix = await fetch(`${pUrl}/__imago/api?u=${encodeURIComponent('https://shop.test/api/items')}`)
const fixBody = await apiFix.text()
check('api mode fixtures replays the recorded response', apiFix.status === 200 && fixBody === '{"items":[1,2]}', fixBody)
const apiUnknown = await fetch(`${pUrl}/__imago/api?u=${encodeURIComponent('https://shop.test/api/nope')}`)
check('a call nobody recorded is reported, not invented', apiUnknown.status === 404)

// the failure that made a bundle render and then blank: a same-origin POST api call
const gqlReplay = await fetch(`${pUrl}/__imago/api?u=${encodeURIComponent('https://shop.test/graphql')}&m=POST`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: gqlRequest,
})
const gqlBody = await gqlReplay.text()
check("a same-origin POST api call is replayed from the session's own recording",
  gqlReplay.status === 200 && gqlBody === gqlResponse, `${gqlReplay.status} ${gqlBody}`)

// E-11 — the same call, arriving the way the rewritten bundle actually makes it:
// a relative POST on our own origin, with no service worker involved at all
await post('/api/preview/mode', { runId: manifest.runId, mode: 'fixtures' })
const viaNamespace = await fetch(`${pUrl}/__imago/h/graphql.shop.test/graphql/`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ operationName: 'Hero', variables: { currency: 'BRL' } }),
})
check('a rewritten-origin api call is replayed with no worker involved',
  viaNamespace.status === 200 && (await viaNamespace.text()).includes('Double Feature'),
  String(viaNamespace.status))

const variablesDiffer = await fetch(`${pUrl}/__imago/h/graphql.shop.test/graphql/`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ operationName: 'Hero', variables: { currency: 'EUR' } }),
})
const differBody = await variablesDiffer.text()
check('the same operation with different variables still answers, labelled',
  variablesDiffer.status === 200 && differBody.includes('Double Feature'), differBody.slice(0, 80))

const noFixture = await fetch(`${pUrl}/__imago/h/graphql.shop.test/graphql/`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ operationName: 'NobodyBrowsedThis', variables: {} }),
})
const missBody = JSON.parse(await noFixture.text()) as { data: unknown; errors?: { message: string }[] }
check('a graphql miss answers in graphql shape, so the client degrades instead of throwing',
  noFixture.status === 200 && missBody.data === null && !!missBody.errors?.[0]?.message,
  JSON.stringify(missBody).slice(0, 120))

// and a data request must never be answered with the entry document
const dataMiss = await fetch(pUrl + '/api/unknown-route', { headers: { accept: 'application/json' } })
const dataMissBody = await dataMiss.text()
check('an unknown data path answers 404, not the html entry',
  dataMiss.status === 404 && !dataMissBody.includes('<!doctype'), `${dataMiss.status} ${dataMissBody.slice(0, 40)}`)
const navMiss = await fetch(pUrl + '/some/client/route', { headers: { accept: 'text/html' } })
check('an unknown navigation still gets the app shell (client routing)',
  navMiss.status === 200 && (await navMiss.text()).includes('<!doctype'))

// E-17 — the three failures a real bundle showed, each one now an assert.

// (a) the rewrite that forged a host: JS holds `//host/x`, app code prefixes
// `"https:"`, and a root-relative replacement yields `https:/__imago/…` — which
// the browser resolves as the host `__imago`. That rule had to die.
const rw = originRewrites([{ url: 'https://graphql.shop.test/graphql/' }], 'shop.test')
check('the protocol-relative origin form is never rewritten',
  !rw.some(([from]) => from.startsWith('//')), JSON.stringify(rw))
check('both absolute schemes still are',
  rw.length === 2 && rw.every(([from]) => /^https?:\/\/graphql\.shop\.test$/.test(from)),
  JSON.stringify(rw))

// (b) a beacon that gets a 404 throws inside its SDK, the error boundary catches
// it, and the whole page becomes "something went wrong". An empty 200 is what a
// beacon sees when it is simply not wanted.
const beacon = await fetch(
  `${pUrl}/__imago/api?u=${encodeURIComponent('https://beacon.telemetry.test/collect')}&m=POST`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"e":1}' },
)
const beaconBody = await beacon.text()
check('a recorded telemetry host is answered, not 404ed', beacon.status === 200 && beaconBody === '{}',
  `${beacon.status} ${beaconBody}`)

// (c) an asset the bundle does not hold is a capture gap. Routed through the
// fixture layer it is reported as a missing API call, which sends the reader
// looking for a backend that was never involved.
const missAsset = await fetch(`${pUrl}/__imago/h/static.shop.test/chunks/lazy.part.js`)
check('a missing asset answers 404 as an asset, not as a fixture miss',
  missAsset.status === 404 && (missAsset.headers.get('content-type') ?? '').includes('text/plain'),
  `${missAsset.status} ${missAsset.headers.get('content-type')}`)

const previewState = await fetch(url + 'api/state').then((r) => r.json()) as any
const pTape = (previewState.previews ?? []).find((p: any) => p.runId === manifest.runId)?.tape ?? []
check('the missing asset is on the tape as a capture gap',
  pTape.some((e: any) => e.kind === 'missing-asset' && e.url.includes('lazy.part.js')),
  JSON.stringify(pTape.slice(-3)))
check('the beacon is on the tape as a stub, so it is never mistaken for data',
  pTape.some((e: any) => e.note === 'telemetry stub' && e.status === 200),
  JSON.stringify(pTape.slice(-3)))

await post('/api/preview/stop', { runId: manifest.runId })
const afterStop = await fetch(pUrl + '/').then(() => 'up').catch(() => 'down')
check('stopping the preview releases its origin', afterStop === 'down')

// ── `flat`, end to end, over real HTTP (D-042) ───────────────────────────────
//
// The chain that matters here is different from rehost's. rehost proves "the byte
// the running app will ask for is served". flat proves "the page the operator saw
// is rebuilt from the tree and the cascade, holds no script, and asks for nothing
// we do not have". The last clause is the one that was never true before.
{
  const flatGen = await post('/api/generate', { sessionId: gid })
  check('flat is the default emitter', flatGen.body?.manifest?.emitter === 'flat',
    JSON.stringify(flatGen.body?.manifest?.emitter ?? flatGen.body))
  const fm = flatGen.body.manifest
  check('flat entry is the marked snapshot, at the web root', fm.entry === '/index.html', fm.entry)

  const fStart = await post('/api/preview/start', { sessionId: gid, runId: fm.runId, mode: 'off' })
  check('the flat preview starts', fStart.body?.preview?.url !== undefined,
    `${fStart.status} ${JSON.stringify(fStart.body)}`)
  const fUrl = String(fStart.body?.preview?.url ?? '').replace(/\/$/, '')

  const doc = await fetch(fUrl + '/')
  const html = await doc.text()
  check('the flat entry is served as html', (doc.headers.get('content-type') ?? '').includes('text/html'))

  // the whole point of the emitter
  check('the flat document ships no script at all', !/<script/i.test(html))
  check('and no service worker boot either', !html.includes('imago-sw.js'))

  // the authored cascade, ours, in order
  const sheetHrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]!)
  check('the cascade is referenced as our own ordered files',
    sheetHrefs.length === 1 && /^styles\/000-[0-9a-f]{16}\.css$/.test(sheetHrefs[0]!),
    JSON.stringify(sheetHrefs))
  const sheet = await fetch(`${fUrl}/${sheetHrefs[0]}`)
  const sheetText = await sheet.text()
  check('the stylesheet is served from the bundle', sheet.status === 200)
  check('a :hover rule survived into the flat cascade', sheetText.includes('a:hover'))
  // Resolved the way a browser resolves it — against the stylesheet's URL, not the
  // document's. The previous version of this assert matched the string
  // `url('assets/…')` and passed while the real page 404ed three fonts at
  // `/styles/assets/…`: a string assert cannot see a resolution rule.
  const sheetUrl = new URL(sheetHrefs[0]!, fUrl + '/')
  const cssTargets = [...sheetText.matchAll(/url\('([^']+)'\)/g)]
    .map((m) => m[1]!)
    .filter((u) => !/^(data:|about:)/.test(u))
  check('the cascade references assets one level up, as a stylesheet must',
    cssTargets.length > 0 && cssTargets.every((u) => u.startsWith('../assets/')),
    JSON.stringify(cssTargets))
  for (const rel of new Set(cssTargets)) {
    const resolved = new URL(rel, sheetUrl).toString()
    const res = await fetch(resolved)
    check(`the browser's own resolution of ${rel} finds a byte`, res.status === 200,
      `${resolved} → ${res.status}`)
  }

  // assets: content-addressed, and actually there
  const assetRefs = [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map((m) => m[1]!)
  check('an image is rewritten to a content-addressed asset',
    assetRefs.some((r) => /^assets\/[0-9a-f]{16}\.png$/.test(r)), JSON.stringify(assetRefs))
  for (const ref of new Set(assetRefs)) {
    const res = await fetch(`${fUrl}/${ref}`)
    check(`the bundle holds ${ref}`, res.status === 200, String(res.status))
  }

  // E2, made checkable: nothing in the emitted document points at the internet
  check('no document in the flat bundle points at the real internet',
    !/(?:src|href)="https?:\/\/(?!elsewhere\.test)/.test(html),
    (html.match(/(?:src|href)="https?:\/\/[^"]*"/g) ?? []).join(' | '))
  check('an outbound <a href> is still left alone — a link is not a byte',
    html.includes('href="https://elsewhere.test/go"'))

  // the tape is the oracle: a complete flat bundle asks for nothing it lacks
  const fState = await fetch(url + 'api/state').then((r) => r.json()) as any
  const fTape = (fState.previews ?? []).find((p: any) => p.runId === fm.runId)?.tape ?? []
  check('loading the flat bundle produced no missing asset and no api call',
    !fTape.some((e: any) => e.kind === 'missing' || e.kind === 'missing-asset' || e.kind === 'blocked'),
    JSON.stringify(fTape.filter((e: any) => e.kind !== 'local').slice(0, 4)))

  // a flat bundle has no router, so it must not answer for a page it never captured
  const ghost = await fetch(fUrl + '/some/page/we/never/captured', { headers: { accept: 'text/html' } })
  const ghostBody = await ghost.text()
  check('an uncaptured path 404s instead of showing the homepage under a fake url',
    ghost.status === 404, String(ghost.status))
  check('the dead end names the url that was asked for',
    ghostBody.includes('/some/page/we/never/captured'), ghostBody.slice(0, 120))
  check('and lists the pages this bundle actually holds, so it doubles as an index',
    ghostBody.includes('Pages this bundle holds') && ghostBody.includes('index.html'))
  check('it is not the captured page served under a url nobody captured',
    !ghostBody.includes('captured page'), ghostBody.slice(0, 120))

  // the second snapshot became its own document, and the first links to it
  check('every snapshot became a document', Object.values(fm.routes as Record<string, string>)
    .filter((p) => p.endsWith('index.html')).length >= 1)

  await post('/api/preview/stop', { runId: fm.runId })
}

// ── parity harness (F4.5) ─────────────────────────────────────────────────────
const o4fail = analyzeO4([
  { seq: 1, at: new Date().toISOString(), kind: 'missing-asset', method: 'GET',
    url: 'https://cdn.test/missing.png', note: 'not in bundle' },
])
check('O4 fails when assets are missing from the bundle', !o4fail.pass && o4fail.missingAsset === 1)
const o4ok = analyzeO4([
  { seq: 1, at: new Date().toISOString(), kind: 'fixture', method: 'GET', url: 'https://shop.test/api/items' },
  { seq: 2, at: new Date().toISOString(), kind: 'bundle', method: 'GET', url: 'https://shop.test/a.css' },
])
check('O4 passes when tape has no gaps', o4ok.pass)

const o4noise = analyzeO4([
  { seq: 1, at: new Date().toISOString(), kind: 'missing', method: 'POST',
    url: 'https://sentry.eneba.com/api/3/envelope/', note: 'no fixture' },
  { seq: 2, at: new Date().toISOString(), kind: 'missing-asset', method: 'GET',
    url: 'https://cdn.test/missing.png', note: 'not in bundle' },
])
check('O4 ignores telemetry beacons', o4noise.ignored === 1 && o4noise.missingAsset === 1 && !o4noise.pass)
check('O4 dedupes repeated gaps', analyzeO4([
  { seq: 1, at: new Date().toISOString(), kind: 'missing-asset', method: 'GET', url: 'https://cdn.test/x.png' },
  { seq: 2, at: new Date().toISOString(), kind: 'missing-asset', method: 'GET', url: 'https://cdn.test/x.png' },
]).gaps.length === 1)

const o4b = analyzeO4b([
  { seq: 1, at: new Date().toISOString(), kind: 'missing', method: 'POST',
    url: 'https://gql.test/graphql', note: 'pq abcdef123456 no fixture' },
], gid)
check('O4b lists graphql fixtures that were not recorded', !o4b.pass && o4b.graphqlMissing.length === 1)

const noReport = await fetch(
  `${url}api/parity/report?sessionId=${gid}&runId=${manifest.runId}`,
).then((r) => r.status)
check('GET parity report 404 before a run', noReport === 404)

const parity = await post('/api/parity/run', { sessionId: gid, runId: manifest.runId })
if (parity.status === 200 && parity.body?.report?.schema === 1) {
  check('parity run writes a versioned report', true)
  check('parity report has O4/O4b/O1 oracles',
    parity.body.report.oracles?.O4 && parity.body.report.oracles?.O4b && parity.body.report.oracles?.O1)
  check('parity report is readable from disk',
    readParityReport(gid, manifest.runId)?.runId === manifest.runId)
  const got = await fetch(
    `${url}api/parity/report?sessionId=${gid}&runId=${manifest.runId}`,
  ).then((r) => r.json()) as any
  check('GET parity report returns the same run', got.report?.runId === manifest.runId)
} else {
  console.log(`  skip parity e2e (needs Chrome): ${JSON.stringify(parity.body?.error ?? parity.status)}`)
}

// ── management (D-031) ────────────────────────────────────────────────────────
const renamed = await post('/api/session/rename', { id: gid, name: 'renamed by hand' })
check('rename answers ok', renamed.body?.ok === true)
const sessionsAfter = await fetch(url + 'api/state').then((r) => r.json()) as any
check('the overlay renames without rewriting the session',
  sessionsAfter.sessions.find((x: any) => x.id === gid)?.name === 'renamed by hand')
check('the session file itself is untouched (S-1)', readMeta(gid)?.name === 'generated')

const sizes = await fetch(url + 'api/sizes').then((r) => r.json()) as Record<string, number>
check('management reports disk size per session', (sizes[gid] ?? 0) > 0, JSON.stringify(sizes))

const del = await post('/api/session/delete', { ids: [gid] })
check('delete removes the session', del.body?.deleted?.includes(gid), JSON.stringify(del.body))
check('the session directory is gone', !existsSync(sessionDir(gid)))
const delNothing = await post('/api/session/delete', { ids: [] })
check('delete with no ids is refused in words', delNothing.status === 400)

// ── the session shape that shipped a bundle with no entry (D-043) ────────────
//
// A real session holds several snapshots of the *same* page — one every time it
// settles, one every 20 s (A-12) — and often not a single `mark`. The first flat
// bundle generated from one of those served 404 at its own root: the document path
// was keyed by URL while being decided per snapshot, so the four snapshots of one
// page overwrote each other's mapping and no `index.html` was ever written.
//
// Two fixtures with two different URLs could never catch that. This one has one URL
// and four snapshots, exactly like the session that failed.
{
  const rid = 'sess-onepage'
  const rdir = ensureDirs(rid)
  writeMeta({ ...meta, id: rid, name: 'one page, four snapshots', status: 'closed', origins: ['shop.test'] })
  const rput = (text: string | Buffer) => {
    const h = hashBytes(text)
    writeFileSync(join(rdir, 'blobs', h), text)
    return h
  }
  const pageCss = rput('a:hover{color:red}')
  writeFileSync(join(rdir, 'network', 'r0.json'), JSON.stringify({
    reqId: 'r0', at: meta.openedAt, method: 'GET', url: 'https://shop.test/produto',
    host: 'shop.test', resourceType: 'document', status: 200,
    requestHeaders: {}, responseHeaders: { 'content-type': 'text/html' },
    responseBodyHash: rput('<html></html>'), bytes: 13, kind: 'asset',
  }))
  // four settle snapshots, one url, no mark — the shape that broke
  for (let i = 0; i < 4; i++) {
    const t = el('html', {}, [
      el('head', {}, [el('title', {}, [txt(`state ${i}`)])]),
      el('body', {}, [el('p', {}, [txt(`revision ${i}`)])]),
    ])
    writeFileSync(join(rdir, 'trees', `${hashJson(t)}.json`), canonicalJson(t))
    writeFileSync(join(rdir, 'snapshots', `snap-000${i}.json`), JSON.stringify({
      id: `snap-000${i}`, trigger: 'settle', at: meta.openedAt,
      url: 'https://shop.test/produto', title: `state ${i}`,
      viewport: { width: 1280, height: 800, dpr: 1 },
      tree: hashJson(t), styles: [pageCss], refs: [],
    }))
  }

  const oneGen = await post('/api/generate', { sessionId: rid })
  check('a session with no marks still generates', oneGen.body?.manifest !== undefined,
    `${oneGen.status} ${JSON.stringify(oneGen.body)}`)
  const om = oneGen.body.manifest
  check('four snapshots of one page become one document, not four',
    Object.values(om.routes as Record<string, string>).filter((p) => p.endsWith('index.html')).length === 1,
    JSON.stringify(om.routes))
  check('and that document is the entry, at the root',
    om.routes['https://shop.test/produto'] === '/index.html', JSON.stringify(om.routes))
  check('the operator is told which snapshot was emitted and that the others remain',
    om.warnings.some((w: string) => w.includes('4 snapshots captured') && w.includes('you marked none')),
    JSON.stringify(om.warnings))

  const oneStart = await post('/api/preview/start', { sessionId: rid, runId: om.runId, mode: 'off' })
  const oneUrl = String(oneStart.body?.preview?.url ?? '').replace(/\/$/, '')
  const root = await fetch(oneUrl + '/')
  const rootText = await root.text()
  check('the bundle root serves a document instead of 404ing', root.status === 200, String(root.status))
  check('and it is the most recent state the recorder captured',
    rootText.includes('revision 3'), rootText.slice(0, 120))
  await post('/api/preview/stop', { runId: om.runId })

  // now the same page with a mark in the middle: curation beats sampling
  const markedTree = el('html', {}, [
    el('head', {}, [el('title', {}, [txt('marked')])]),
    el('body', {}, [el('p', {}, [txt('the state I chose')])]),
  ])
  writeFileSync(join(rdir, 'trees', `${hashJson(markedTree)}.json`), canonicalJson(markedTree))
  writeFileSync(join(rdir, 'snapshots', 'snap-0002.json'), JSON.stringify({
    id: 'snap-0002', trigger: 'mark', at: meta.openedAt,
    url: 'https://shop.test/produto', title: 'marked',
    viewport: { width: 1280, height: 800, dpr: 1 },
    tree: hashJson(markedTree), styles: [pageCss], refs: [],
  }))
  const markedGen = await post('/api/generate', {
    sessionId: rid,
    profile: { emitter: 'flat', apiBase: null, hosts: {}, defaultDisposition: 'keep' },
  })
  const mm = markedGen.body.manifest
  const mStart = await post('/api/preview/start', { sessionId: rid, runId: mm.runId, mode: 'off' })
  const mUrl = String(mStart.body?.preview?.url ?? '').replace(/\/$/, '')
  const mRoot = await fetch(mUrl + '/').then((r) => r.text())
  check('a marked state wins over a later automatic one — curation beats sampling',
    mRoot.includes('the state I chose'), mRoot.slice(0, 140))
  await post('/api/preview/stop', { runId: mm.runId })
}

// ── the flat serializer, as a unit (D-042) ───────────────────────────────────
const flatProof = proveFlatHtml()
for (const line of flatProof.lines) console.log(line)
failures += flatProof.failures

// ── the resolver, against a simulated application (C-4c/C-4e) ─────────────────
const proof = await proveResolver()
for (const line of proof.lines) console.log(line)
failures += proof.failures

await stopPanel()

console.log(failures ? `\n${failures} failure(s)` : '\nall ok')
process.exit(failures ? 1 : 0)
